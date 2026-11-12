"""Demo kamera: simulovaná lednice vykreslená v Pillow.

Nahrazuje Reolink, dokud není připojený. Scéna je "fyzický svět": má police,
šuplík a přihrádky ve dveřích a v nich objekty. Z UI (nebo z CLI) jde věc
vzít, vrátit nebo upít a kamera pak vyfotí novou scénu, kterou zpracuje
stejný řetězec jako u skutečné kamery (změny ve snímku -> vision -> inventář).

`ground_truth` ve snímku čte jen mock vision. Skutečné modely dostanou jen obrázek.
"""

from __future__ import annotations

import io
import random
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from ..db import utcnow
from ..food.catalog import BY_KEY, FoodSpec, find_spec
from ..schemas import BBox, CameraInfo, Detection, LiveStreamInfo, Shelf
from .base import Frame

W, H = 1280, 800
SS = 2  # supersampling kvůli hladkým hranám

FONT_CANDIDATES = (
    "/System/Library/Fonts/SFNS.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
)
FONT_BOLD_CANDIDATES = (
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    *FONT_CANDIDATES,
)


@lru_cache(maxsize=32)
def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_BOLD_CANDIDATES if bold else FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default(size=size)


@dataclass
class Slot:
    shelf: Shelf
    x: int
    y: int  # spodní hrana (věci stojí na polici)
    w: int
    h: int  # maximální výška


@dataclass
class SceneObject:
    spec: FoodSpec
    slot: int
    fill_level: float | None = None
    quantity: float | None = None
    expires_on: date | None = None
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])


def _layout(camera: str) -> list[Slot]:
    slots: list[Slot] = []
    if camera == "cam0":
        rows = (("top", 250, 150, 5), ("middle", 470, 190, 5), ("bottom", 650, 150, 4), ("drawer", 785, 110, 5))
        for shelf, y, h, n in rows:
            margin = 170 if shelf != "drawer" else 200
            span = W - 2 * margin
            for i in range(n):
                slots.append(Slot(shelf, margin + i * span // n, y, span // n, h))  # type: ignore[arg-type]
    else:
        for y in (300, 525, 760):
            margin = 120
            span = W - 2 * margin
            n = 5
            for i in range(n):
                slots.append(Slot("door", margin + i * span // n, y, span // n, 185))
    return slots


SHELF_TO_CAMERA: dict[Shelf, str] = {
    "top": "cam0",
    "middle": "cam0",
    "bottom": "cam0",
    "drawer": "cam0",
    "door": "cam1",
    "unknown": "cam0",
}


class DemoWorld:
    """Stav simulované lednice pro obě kamery."""

    def __init__(self, *, seed: int = 7, today: date | None = None) -> None:
        self.rng = random.Random(seed)
        self.today = today or date.today()
        self.door_open = True
        self.layouts = {"cam0": _layout("cam0"), "cam1": _layout("cam1")}
        self.objects: dict[str, list[SceneObject]] = {"cam0": [], "cam1": []}

    # ------------------------------------------------------------- scéna
    def seed_default(self) -> None:
        plan: list[tuple[str, dict]] = [
            ("toustovy-chleb", {"expires": 3}),
            ("tortilly", {"expires": 9}),
            ("hummus", {"expires": 4}),
            ("zbytky-jidla", {"expires": 0}),
            ("jahody", {"expires": 1}),
            ("vejce", {"quantity": 6, "expires": 16}),
            ("jogurt-bily", {"quantity": 2, "expires": 6}),
            ("syr-eidam", {"expires": 12}),
            ("sunka", {"expires": -1}),
            ("tvaroh", {"expires": 5}),
            ("kureci-prsa", {"expires": 1}),
            ("pivo", {"quantity": 4, "expires": 120}),
            ("losos", {"expires": 2}),
            ("rajcata", {"quantity": 4, "expires": 5}),
            ("okurka", {"expires": 4}),
            ("paprika", {"quantity": 2, "expires": 8}),
            ("jablka", {"quantity": 5, "expires": 20}),
            ("brokolice", {"expires": 3}),
            ("cesnek", {"expires": 40}),
            ("pesto", {"expires": 6}),
            ("mleko", {"fill": 0.2, "expires": 4}),
            ("kefir", {"fill": 0.9, "expires": 7}),
            ("maslo", {"expires": 18}),
            ("kecup", {"fill": 0.5, "expires": 90}),
            ("horcice", {"expires": 120}),
            ("dzem", {"expires": 60}),
            ("dzus", {"fill": 0.6, "expires": 6}),
            ("minerálka", {"fill": 1.0, "expires": 300}),
            ("citron", {"quantity": 2, "expires": 12}),
            ("bile-vino", {"fill": 1.0, "expires": 365}),
        ]
        for key, opts in plan:
            self.put(
                key,
                expires_in_days=opts.get("expires"),
                fill_level=opts.get("fill"),
                quantity=opts.get("quantity"),
            )

    def put(
        self,
        key_or_name: str,
        *,
        expires_in_days: int | None = None,
        fill_level: float | None = None,
        quantity: float | None = None,
    ) -> SceneObject | None:
        spec = BY_KEY.get(key_or_name) or find_spec(key_or_name)
        if spec is None:
            return None
        camera = SHELF_TO_CAMERA[spec.shelf]
        slot = self._free_slot(camera, spec.shelf)
        if slot is None:
            return None
        if fill_level is None and spec.shape in ("bottle", "carton"):
            fill_level = 1.0
        days = expires_in_days if expires_in_days is not None else spec.shelf_days
        obj = SceneObject(
            spec=spec,
            slot=slot,
            fill_level=fill_level,
            quantity=quantity if quantity is not None else spec.default_qty,
            expires_on=self.today + timedelta(days=days),
        )
        self.objects[camera].append(obj)
        return obj

    def take(self, key_or_name: str) -> tuple[str, SceneObject] | None:
        spec = BY_KEY.get(key_or_name) or find_spec(key_or_name)
        if spec is None:
            return None
        for camera, objs in self.objects.items():
            for obj in objs:
                if obj.spec.key == spec.key:
                    objs.remove(obj)
                    return camera, obj
        return None

    def use(self, key_or_name: str, amount: float = 0.3) -> tuple[str, SceneObject] | None:
        """Upije/ují: sníží hladinu nebo počet kusů."""
        spec = BY_KEY.get(key_or_name) or find_spec(key_or_name)
        if spec is None:
            return None
        for camera, objs in self.objects.items():
            for obj in objs:
                if obj.spec.key != spec.key:
                    continue
                if obj.fill_level is not None:
                    obj.fill_level = round(max(0.05, obj.fill_level - amount), 2)
                elif obj.quantity and obj.quantity > 1:
                    obj.quantity = max(1, obj.quantity - max(1, round(amount * obj.quantity)))
                return camera, obj
        return None

    def _free_slot(self, camera: str, shelf: Shelf) -> int | None:
        used = {o.slot for o in self.objects[camera]}
        layout = self.layouts[camera]
        preferred = [i for i, s in enumerate(layout) if s.shelf == shelf and i not in used]
        if preferred:
            return preferred[0]
        others = [i for i in range(len(layout)) if i not in used]
        return others[0] if others else None

    def contents(self) -> list[dict]:
        out = []
        for camera, objs in self.objects.items():
            for o in objs:
                out.append(
                    {
                        "camera_id": camera,
                        "key": o.spec.key,
                        "name": o.spec.name,
                        "emoji": o.spec.emoji,
                        "fill_level": o.fill_level,
                        "quantity": o.quantity,
                        "expires_on": o.expires_on.isoformat() if o.expires_on else None,
                    }
                )
        return out

    # ------------------------------------------------------------- render
    def render(self, camera: str, *, now: datetime | None = None) -> Frame:
        now = now or utcnow()
        img = Image.new("RGB", (W * SS, H * SS), "#dfe6ee")
        d = ImageDraw.Draw(img, "RGBA")
        if camera == "cam0":
            self._draw_interior(img, d)
        else:
            self._draw_door(img, d)
        truth: list[Detection] = []
        for obj in sorted(self.objects[camera], key=lambda o: self.layouts[camera][o.slot].y):
            slot = self.layouts[camera][obj.slot]
            box = self._draw_object(d, obj, slot)
            truth.append(self._truth(obj, slot, box))
        if camera == "cam1":
            self._draw_door_bins_front(d)
        img = img.resize((W, H), Image.Resampling.LANCZOS)
        if not self.door_open:
            img = self._night_vision(img)
        self._draw_osd(img, camera, now)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=86, optimize=True)
        return Frame(
            camera_id=camera,
            jpeg=buf.getvalue(),
            taken_at=now,
            width=W,
            height=H,
            ground_truth=truth if self.door_open else [],
            door_open=self.door_open,
        )

    # pomocné kreslení (souřadnice v supersamplovaném prostoru)
    @staticmethod
    def _s(*vals: float) -> tuple[int, ...]:
        return tuple(int(v * SS) for v in vals)

    def _draw_interior(self, img: Image.Image, d: ImageDraw.ImageDraw) -> None:
        s = self._s
        # zadní stěna s jemným přechodem
        for i in range(H):
            t = i / H
            c = (int(232 - 30 * t), int(238 - 26 * t), int(245 - 20 * t))
            d.line([s(0, i), s(W, i)], fill=c, width=SS)
        # boční stěny v perspektivě
        d.polygon([s(0, 0), s(150, 60), s(150, 790), s(0, H)], fill=(196, 206, 218, 255))
        d.polygon([s(W, 0), s(W - 150, 60), s(W - 150, 790), s(W, H)], fill=(190, 201, 214, 255))
        # LED pásek a záře
        glow = Image.new("RGBA", img.size, (255, 255, 255, 0))
        gd = ImageDraw.Draw(glow)
        gd.ellipse(s(240, -120, W - 240, 160), fill=(255, 255, 255, 170))
        glow = glow.filter(ImageFilter.GaussianBlur(40 * SS))
        img.paste(glow, (0, 0), glow)
        d.rounded_rectangle(s(330, 18, W - 330, 34), radius=8 * SS, fill=(255, 255, 255, 255))
        # skleněné police
        for y in (250, 470, 650):
            d.polygon([s(150, y), s(W - 150, y), s(W - 120, y + 18), s(120, y + 18)], fill=(205, 232, 240, 170))
            d.line([s(120, y + 18), s(W - 120, y + 18)], fill=(255, 255, 255, 230), width=3 * SS)
            d.line([s(150, y), s(W - 150, y)], fill=(160, 190, 205, 200), width=2 * SS)
        # šuplík na zeleninu
        d.rounded_rectangle(s(150, 668, W - 150, 798), radius=18 * SS, fill=(220, 233, 240, 120),
                            outline=(170, 190, 205, 220), width=3 * SS)

    def _draw_door(self, img: Image.Image, d: ImageDraw.ImageDraw) -> None:
        s = self._s
        for i in range(H):
            t = i / H
            c = (int(240 - 25 * t), int(243 - 22 * t), int(247 - 18 * t))
            d.line([s(0, i), s(W, i)], fill=c, width=SS)
        d.rounded_rectangle(s(60, 40, W - 60, H - 20), radius=40 * SS, outline=(200, 210, 220, 255), width=6 * SS)
        glow = Image.new("RGBA", img.size, (255, 255, 255, 0))
        gd = ImageDraw.Draw(glow)
        gd.ellipse(s(-200, -200, 500, 400), fill=(255, 255, 255, 140))
        glow = glow.filter(ImageFilter.GaussianBlur(50 * SS))
        img.paste(glow, (0, 0), glow)

    def _draw_door_bins_front(self, d: ImageDraw.ImageDraw) -> None:
        s = self._s
        for y in (300, 525, 760):
            d.rounded_rectangle(s(100, y - 60, W - 100, y + 12), radius=14 * SS, fill=(214, 236, 246, 150),
                                outline=(170, 196, 212, 230), width=3 * SS)
            d.line([s(120, y - 52), s(W - 120, y - 52)], fill=(255, 255, 255, 200), width=2 * SS)

    def _draw_object(self, d: ImageDraw.ImageDraw, obj: SceneObject, slot: Slot) -> tuple[int, int, int, int]:
        """Nakreslí objekt a vrátí jeho obdélník (x0, y0, x1, y1) v pixelech výsledného snímku."""
        s = self._s
        spec = obj.spec
        cx = slot.x + slot.w // 2
        base = slot.y
        shape = spec.shape
        dims = {
            "bottle": (64, slot.h), "carton": (92, slot.h - 10), "jar": (100, 92), "tub": (120, 70),
            "pack": (170, 70), "round": (110, 96), "bunch": (150, 80), "eggs": (190, 64),
            "can": (70, 118), "bag": (170, 120), "block": (130, 56), "box": (150, 86),
        }
        w, h = dims.get(shape, (120, 90))
        w = min(w, slot.w - 16)
        h = min(h, slot.h - 6)
        x0, y0, x1, y1 = cx - w // 2, base - h, cx + w // 2, base
        col = spec.color
        dark = (40, 48, 60, 255)
        # stín
        d.ellipse(s(x0 + 6, y1 - 8, x1 + 10, y1 + 6), fill=(40, 60, 80, 60))
        if shape == "bottle":
            neck = w // 3
            d.rounded_rectangle(s(x0, y0 + 36, x1, y1), radius=18 * SS, fill=(220, 238, 248, 170),
                                outline=(150, 175, 195, 255), width=2 * SS)
            level = obj.fill_level if obj.fill_level is not None else 1.0
            ly = y1 - int((y1 - y0 - 40) * level)
            d.rounded_rectangle(s(x0 + 4, ly, x1 - 4, y1 - 4), radius=14 * SS, fill=_rgba(col, 235))
            d.rectangle(s(cx - neck // 2, y0 + 8, cx + neck // 2, y0 + 40), fill=(220, 238, 248, 200),
                        outline=(150, 175, 195, 255), width=2 * SS)
            d.rounded_rectangle(s(cx - neck // 2 - 2, y0, cx + neck // 2 + 2, y0 + 12), radius=3 * SS,
                                fill=_rgba("#2c3e50"))
            label_y = y0 + (y1 - y0) // 2
        elif shape == "carton":
            d.polygon([s(x0, y0 + 26), s(cx, y0), s(x1, y0 + 26)], fill=_rgba(col), outline=_rgba("#b0bec5"))
            d.rectangle(s(x0, y0 + 26, x1, y1), fill=_rgba(col), outline=_rgba("#b0bec5"), width=2 * SS)
            d.rectangle(s(x0, y0 + 60, x1, y0 + 110), fill=_rgba("#2e86de", 230))
            d.rounded_rectangle(s(cx + 10, y0 + 6, cx + 26, y0 + 20), radius=4 * SS, fill=_rgba("#1b4f72"))
            if obj.fill_level is not None:
                bar = int((y1 - y0 - 130) * obj.fill_level)
                d.rectangle(s(x1 - 10, y1 - 8 - bar, x1 - 4, y1 - 8), fill=_rgba("#5dade2", 200))
            label_y = y0 + 85
        elif shape == "jar":
            d.rounded_rectangle(s(x0, y0 + 14, x1, y1), radius=16 * SS, fill=_rgba(col, 240),
                                outline=_rgba("#7f8c8d"), width=2 * SS)
            d.rounded_rectangle(s(x0 + 6, y0, x1 - 6, y0 + 20), radius=6 * SS, fill=_rgba("#d35400"))
            label_y = y0 + (y1 - y0) // 2 + 6
        elif shape == "tub":
            d.polygon([s(x0, y0 + 12), s(x1, y0 + 12), s(x1 - 10, y1), s(x0 + 10, y1)], fill=_rgba(col),
                      outline=_rgba("#95a5a6"))
            d.rounded_rectangle(s(x0 - 4, y0, x1 + 4, y0 + 14), radius=5 * SS, fill=_rgba("#3498db"))
            label_y = y0 + (y1 - y0) // 2 + 6
        elif shape == "eggs":
            d.rounded_rectangle(s(x0, y0 + 16, x1, y1), radius=10 * SS, fill=_rgba("#c8b08a"),
                                outline=_rgba("#8d7552"), width=2 * SS)
            count = int(obj.quantity or 6)
            for i in range(min(count, 6)):
                ex = x0 + 18 + i * (w - 36) // 5
                d.ellipse(s(ex - 14, y0, ex + 14, y0 + 34), fill=_rgba("#f6e7cf"), outline=_rgba("#cbb593"))
            label_y = y1 - 20
        elif shape == "round":
            n = int(min(obj.quantity or 1, 3)) if spec.unit == "ks" else 1
            r = min(w, h) // 2
            for i in range(n):
                ox = cx + (i - (n - 1) / 2) * r * 0.9
                d.ellipse(s(ox - r, y1 - 2 * r, ox + r, y1), fill=_rgba(col), outline=_rgba("#00000040"))
                d.ellipse(s(ox - r * 0.5, y1 - 1.7 * r, ox - r * 0.1, y1 - 1.3 * r), fill=(255, 255, 255, 90))
            x0, x1 = int(cx - r * (1 + 0.45 * (n - 1))), int(cx + r * (1 + 0.45 * (n - 1)))
            y0 = y1 - 2 * r
            label_y = None
        elif shape == "bunch":
            for i in range(5):
                ox = x0 + 20 + i * (w - 40) // 4
                d.ellipse(s(ox - 26, y0 + 10 + (i % 2) * 14, ox + 26, y1), fill=_rgba(col),
                          outline=_rgba("#00000030"))
            label_y = None
        elif shape == "can":
            d.rounded_rectangle(s(x0, y0, x1, y1), radius=10 * SS, fill=_rgba(col), outline=_rgba("#7d6608"))
            d.rectangle(s(x0, y0 + 30, x1, y0 + 70), fill=_rgba("#1d1d1d", 220))
            label_y = y0 + 50
            if (obj.quantity or 1) > 1:
                d.rounded_rectangle(s(x0 + 20, y0 - 8, x1 + 20, y1 - 8), radius=10 * SS, fill=_rgba(col, 160))
        else:  # pack, bag, block, box
            radius = 22 if shape == "bag" else 10
            d.rounded_rectangle(s(x0, y0, x1, y1), radius=radius * SS, fill=_rgba(col), outline=_rgba("#00000040"),
                                width=2 * SS)
            if shape == "pack":
                d.rounded_rectangle(s(x0 + 14, y0 + 12, x1 - 14, y1 - 12), radius=8 * SS, fill=(255, 255, 255, 80))
            if shape == "box":
                d.rectangle(s(x0, y0, x1, y0 + 16), fill=_rgba("#ffffff", 110))
            label_y = y0 + (y1 - y0) // 2
        if label_y is not None:
            text = spec.name.split()[0][:11].upper()
            font = _font(13 * SS, bold=True)
            tw = d.textlength(text, font=font)
            d.rounded_rectangle(
                (int(cx * SS - tw / 2 - 8 * SS), int((label_y - 11) * SS), int(cx * SS + tw / 2 + 8 * SS),
                 int((label_y + 11) * SS)),
                radius=5 * SS, fill=(255, 255, 255, 215),
            )
            d.text((int(cx * SS - tw / 2), int((label_y - 9) * SS)), text, font=font, fill=dark)
        return x0, y0, x1, y1

    def _truth(self, obj: SceneObject, slot: Slot, box: tuple[int, int, int, int]) -> Detection:
        x0, y0, x1, y1 = box
        jitter = self.rng.uniform(-0.004, 0.004)
        conf = round(self.rng.uniform(0.78, 0.97), 2)
        return Detection(
            label=obj.spec.name,
            canonical=obj.spec.key,
            category=obj.spec.category,
            bbox=BBox(
                x=max(0.0, x0 / W + jitter), y=max(0.0, y0 / H + jitter),
                w=min(1.0, (x1 - x0) / W), h=min(1.0, (y1 - y0) / H),
            ),
            confidence=conf,
            quantity=obj.quantity,
            unit=obj.spec.unit,
            fill_level=obj.fill_level,
            shelf=slot.shelf,
            expiry_text=f"Spotřebujte do: {obj.expires_on:%d.%m.%Y}" if obj.expires_on else None,
            expires_on=obj.expires_on,
            source="mock",
        )

    @staticmethod
    def _night_vision(img: Image.Image) -> Image.Image:
        gray = img.convert("L").point(lambda v: int(v * 0.28))
        noise = Image.effect_noise(gray.size, 22).point(lambda v: int(v * 0.25))
        out = Image.blend(gray, noise, 0.18)
        return Image.merge("RGB", (out, out, out))

    @staticmethod
    def _draw_osd(img: Image.Image, camera: str, now: datetime) -> None:
        d = ImageDraw.Draw(img, "RGBA")
        name = "CAM 01 · POLICE" if camera == "cam0" else "CAM 02 · DVEŘE"
        font = _font(18, bold=True)
        small = _font(16)
        d.rounded_rectangle((14, 14, 28 + d.textlength(name, font=font), 44), radius=6, fill=(0, 0, 0, 120))
        d.text((21, 18), name, font=font, fill=(255, 255, 255, 235))
        stamp = now.astimezone().strftime("%Y-%m-%d %H:%M:%S")
        tw = d.textlength(stamp, font=small)
        d.rounded_rectangle((W - tw - 30, 14, W - 14, 44), radius=6, fill=(0, 0, 0, 120))
        d.text((W - tw - 22, 19), stamp, font=small, fill=(255, 255, 255, 235))
        d.text((18, H - 34), "DEMO · Reolink Argus B310 (simulace)", font=small, fill=(255, 255, 255, 170))


def _rgba(hex_color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    h = hex_color.lstrip("#")
    if len(h) == 8:
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), int(h[6:8], 16)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), alpha


class DemoCamera:
    """Kamera nad DemoWorld se stejným rozhraním jako ReolinkCamera."""

    def __init__(self, world: DemoWorld, camera_id: str, name: str, channel: int) -> None:
        self.world = world
        self.id = camera_id
        self.name = name
        self.channel = channel
        self.last_snapshot_at: datetime | None = None

    async def snapshot(self) -> Frame:
        frame = self.world.render(self.id)
        self.last_snapshot_at = frame.taken_at
        return frame

    async def info(self) -> CameraInfo:
        return CameraInfo(
            id=self.id,
            name=self.name,
            channel=self.channel,
            mode="demo",
            online=True,
            battery_pct=87 if self.channel == 0 else 64,
            wifi_signal=71 if self.channel == 0 else 58,
            last_snapshot_at=self.last_snapshot_at,
            snapshot_url=f"/api/camera/{self.id}/snapshot.jpg",
            live=self.live_stream(),
        )

    def live_stream(self) -> LiveStreamInfo | None:
        return LiveStreamInfo(
            kind="mjpeg",
            url=f"/api/camera/{self.id}/live.mjpeg",
            note="Demo: simulovaný přenos. U Reolinku poběží WebRTC přes go2rtc.",
        )
