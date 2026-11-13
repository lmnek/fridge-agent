"""Testy lokální ViT pipeline (OWLv2 + SigLIP 2 + Florence-2).

Rychlé testy běží i bez PyTorch. Těžké testy se přeskočí, když chybí torch
nebo modely v cache Hugging Face (stáhnou se při prvním použití providera).
Demo snímky jsou ploché ilustrace, takže čísla jsou kouřový test, ne benchmark.
"""

from __future__ import annotations

import asyncio
import dataclasses
import io
import subprocess
import sys
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

from frida.camera.base import Frame
from frida.camera.demo import DemoWorld, _font
from frida.config import Settings
from frida.schemas import BBox, Detection
from frida.vision.base import VisionContext, VisionUnavailable
from frida.vision.local_vit import (
    FLORENCE_OCR,
    Candidate,
    Item,
    LocalViTProvider,
    count_parts,
    merge_items,
    models_cached,
    ocr_engine,
    pick_expiry,
    shelf_for,
    suppress,
)

BACKEND = Path(__file__).resolve().parents[1]
TODAY = date(2026, 11, 13)
CAMERAS = (("cam0", "Police"), ("cam1", "Dveře"))


def _tiny_frame() -> Frame:
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), (200, 200, 200)).save(buf, "JPEG")
    return Frame("cam0", buf.getvalue(), datetime(2026, 11, 13, 8, tzinfo=UTC), 64, 48)


def _ctx(camera_name: str = "Police") -> VisionContext:
    return VisionContext(camera_name=camera_name, today_iso=TODAY.isoformat())


# ---------------------------------------------------------------------------
# Bez PyTorch
# ---------------------------------------------------------------------------


def test_module_imports_without_torch() -> None:
    # Čistý interpret, kde import torch/transformers selže. Modul se musí načíst i tak.
    code = (
        "import sys; sys.modules['torch'] = None; sys.modules['transformers'] = None\n"
        "import frida.vision.local_vit as m\n"
        "assert m.LocalViTProvider.name == 'local-vit'\n"
        "print('ok')"
    )
    out = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, cwd=BACKEND, check=False
    )
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "ok"


async def test_missing_torch_raises_vision_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, "torch", None)
    provider = LocalViTProvider(Settings())
    with pytest.raises(VisionUnavailable, match=r"uv sync --extra vision-local --extra reolink") as first:
        await provider.analyze(_tiny_frame(), _ctx())
    assert "PyTorch" in str(first.value)
    # Neúspěch se pamatuje: další snímek hned dostane stejnou chybu, nic se znovu nenačítá.
    with pytest.raises(VisionUnavailable, match="PyTorch"):
        await provider.analyze(_tiny_frame(), _ctx())


def test_ocr_engine_dispatch() -> None:
    assert ocr_engine(FLORENCE_OCR) == "florence"
    assert ocr_engine("microsoft/trocr-base-printed") == "unsupported"  # čte jen jeden řádek
    assert ocr_engine("") is None
    assert ocr_engine("none") is None


def test_capture_day_is_local_not_utc() -> None:
    # 23:30 UTC je v Praze už další den. Razítko kamery ukazuje místní datum.
    provider = LocalViTProvider(Settings(timezone="Europe/Prague"))
    assert provider.local_date(datetime(2026, 11, 12, 23, 30, tzinfo=UTC)) == date(2026, 11, 13)


def test_shelf_for() -> None:
    assert shelf_for(0.9, "Dveře") == "door"
    assert shelf_for(0.2, "Police") == "top"
    assert shelf_for(0.5, "Police") == "middle"
    assert shelf_for(0.75, "Police") == "bottom"
    assert shelf_for(0.92, "Police") == "drawer"


def test_pick_expiry_accepts_printed_dates() -> None:
    found = pick_expiry(["MLEKO", "Spotřebujte do: 15.11.2026"], today=TODAY, taken_on=TODAY)
    assert found is not None and found[1].on == date(2026, 11, 15)
    found = pick_expiry(["Spotrebujte do:", "20.11.2026"], today=TODAY, taken_on=TODAY)
    assert found is not None and found[1].on == date(2026, 11, 20)
    found = pick_expiry(["MDT 03/2027"], today=TODAY, taken_on=TODAY)
    assert found is not None and found[1].on == date(2027, 3, 31)


def test_pick_expiry_rejects_camera_stamp_and_guesses() -> None:
    assert pick_expiry(["2026-11-13 00:44:08"], today=TODAY, taken_on=TODAY) is None  # razítko kamery
    assert pick_expiry(["13.11.2026"], today=TODAY, taken_on=TODAY) is None  # den pořízení snímku
    assert pick_expiry(["15.11."], today=TODAY, taken_on=TODAY) is None  # bez klíčového slova a roku
    assert pick_expiry(["MLEKO", "EIDAM"], today=TODAY, taken_on=TODAY) is None


def _cand(box: tuple[float, float, float, float], score: float) -> Candidate:
    import numpy as np

    return Candidate(box, score, np.zeros(3, dtype=np.float32))


def test_suppress_counts_eggs_inside_carton() -> None:
    carton = _cand((100, 100, 300, 160), 0.4)
    eggs = [_cand((105 + i * 32, 100, 130 + i * 32, 130), 0.28) for i in range(6)]
    kept = suppress([*eggs, carton])
    assert kept == [carton]
    assert count_parts(kept[0]) == 6


def test_suppress_drops_group_and_shelf_boxes() -> None:
    a, b = _cand((100, 100, 160, 200), 0.45), _cand((200, 100, 260, 200), 0.44)
    shelf = _cand((90, 90, 600, 230), 0.2)  # obsahuje středy obou věcí
    assert suppress([a, b, shelf]) == [a, b]


def test_merge_items_side_by_side() -> None:
    items = [
        Item("jogurt-bily", 0.8, (100, 100, 150, 160), 0),
        Item("jogurt-bily", 0.7, (155, 100, 205, 160), 0),
        Item("jogurt-bily", 0.9, (210, 102, 260, 160), 0),
        Item("tvaroh", 0.9, (265, 100, 315, 160), 0),
        Item("jogurt-bily", 0.9, (700, 100, 750, 160), 0),  # daleko, jiná položka
    ]
    merged = merge_items(items)
    assert [(m.key, m.count) for m in merged] == [("jogurt-bily", 3), ("tvaroh", 0), ("jogurt-bily", 0)]
    assert merged[0].box == (100, 100, 260, 160)
    assert merged[0].confidence == 0.9


# ---------------------------------------------------------------------------
# S modely (přeskočí se bez torch nebo bez modelů v cache)
# ---------------------------------------------------------------------------


def _florence_cached() -> bool:
    from huggingface_hub import try_to_load_from_cache

    return isinstance(try_to_load_from_cache(FLORENCE_OCR, "config.json"), str)


@pytest.fixture(scope="module")
def provider() -> LocalViTProvider:
    pytest.importorskip("torch")
    pytest.importorskip("transformers")
    if not models_cached(Settings()):
        pytest.skip("OWLv2/SigLIP nejsou v cache Hugging Face (stáhnou se při prvním použití)")
    ocr = FLORENCE_OCR if _florence_cached() else ""
    p = LocalViTProvider(Settings(local_vision_ocr=ocr, local_detection_threshold=0.18))
    asyncio.run(p.warmup())
    return p


def _iou(a: BBox, b: BBox) -> float:
    ix = max(0.0, min(a.x + a.w, b.x + b.w) - max(a.x, b.x))
    iy = max(0.0, min(a.y + a.h, b.y + b.h) - max(a.y, b.y))
    inter = ix * iy
    union = a.w * a.h + b.w * b.h - inter
    return inter / union if union else 0.0


def _matches(dets: list[Detection], truth: list[Detection]) -> int:
    used: set[int] = set()
    tp = 0
    for d in sorted(dets, key=lambda d: -d.confidence):
        for j, t in enumerate(truth):
            if (
                j not in used
                and t.canonical == d.canonical
                and d.bbox
                and t.bbox
                and _iou(d.bbox, t.bbox) >= 0.3
            ):
                used.add(j)
                tp += 1
                break
    return tp


async def test_demo_frames_smoke(provider: LocalViTProvider) -> None:
    world = DemoWorld(today=TODAY)
    world.seed_default()
    all_dets: list[Detection] = []
    truth: list[Detection] = []
    for camera, name in CAMERAS:
        frame = world.render(camera)
        gt = frame.ground_truth or []
        # Provider dostane snímek bez "pravdy", skórujeme proti originálu.
        dets = await provider.analyze(dataclasses.replace(frame, ground_truth=None), _ctx(name))
        assert dets, f"{camera}: nic nenalezeno"
        assert all(d.source == "local-vit" and d.bbox is not None for d in dets)
        assert all(d.expires_on is None for d in dets), "demo nemá vytištěná data, přečtené datum je chyba"
        if camera == "cam1":
            assert {d.shelf for d in dets} == {"door"}
        else:
            assert "door" not in {d.shelf for d in dets}
        all_dets += dets
        truth += gt

    localized = sum(any(d.bbox and t.bbox and _iou(d.bbox, t.bbox) >= 0.3 for d in all_dets) for t in truth)
    recall = _matches(all_dets, truth) / len(truth)
    sure = [d for d in all_dets if d.confidence >= 0.55]
    precision_sure = _matches(sure, truth) / max(1, len(sure))
    # Naměřeno na M5 Pro / MPS: lokalizace 0.80, recall 0.60, přesnost nad 0.55 = 1.00.
    assert localized / len(truth) >= 0.7
    assert recall >= 0.45
    assert precision_sure >= 0.85


async def test_ground_truth_is_never_read(provider: LocalViTProvider) -> None:
    world = DemoWorld(today=TODAY)
    world.seed_default()
    frame = world.render("cam1")
    poison = [Detection(label="Pivo", canonical="pivo", confidence=1.0, bbox=BBox(x=0, y=0, w=1, h=1))] * 5
    blind = await provider.analyze(dataclasses.replace(frame, ground_truth=None), _ctx("Dveře"))
    poisoned = await provider.analyze(dataclasses.replace(frame, ground_truth=poison), _ctx("Dveře"))
    assert sorted(d.canonical for d in blind) == sorted(d.canonical for d in poisoned)
    assert "pivo" not in {d.canonical for d in poisoned}


async def test_florence_reads_printed_date(provider: LocalViTProvider) -> None:
    models = provider._models
    assert models is not None
    if models.ocr_model is None:
        pytest.skip("Florence-2 není v cache Hugging Face")
    world = DemoWorld(today=TODAY)
    world.seed_default()
    frame = world.render("cam1")
    milk = next(d for d in frame.ground_truth or [] if d.canonical == "mleko")
    assert milk.bbox is not None
    image = Image.open(io.BytesIO(frame.jpeg)).convert("RGB")
    # Datum vytištěné na krabici (asi 12 px vysoké, jako z kamery na pár desítek centimetrů).
    x0, y0 = int(milk.bbox.x * image.width), int(milk.bbox.y * image.height)
    draw = ImageDraw.Draw(image)
    draw.rectangle((x0 + 2, y0 + 120, x0 + 90, y0 + 160), fill=(255, 255, 255))
    draw.text((x0 + 4, y0 + 122), "Spotřebujte do:", font=_font(11), fill=(20, 20, 20))
    draw.text((x0 + 4, y0 + 140), "15.11.2026", font=_font(13), fill=(20, 20, 20))
    det = Detection(label="Mléko", canonical="mleko", category="dairy", bbox=milk.bbox, confidence=0.9)
    done = provider._read_expiry(
        models, image, [det], _ctx("Dveře"), camera_id="test", today=TODAY, taken_on=TODAY
    )
    assert done == 1
    assert det.expires_on == date(2026, 11, 15), det.expiry_text
