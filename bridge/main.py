"""Fridge Agent bridge.

Owns the fridge state (a JSON file), proxies camera snapshots and mints OpenAI Realtime
session keys. The Realtime model is the whole brain: the browser holds the session, sends it
camera photos and runs its function calls against the endpoints below.
"""

from __future__ import annotations

import asyncio
import json
import os
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

import camera
import courier
import deals
import kitchen_audio
import telegram
import vision
from rohlik import SAFE_TOOLS

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")
load_dotenv(ROOT.parent / ".env")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
REALTIME_MODEL = os.getenv("REALTIME_MODEL", "gpt-realtime-2.1")
REALTIME_VOICE = os.getenv("REALTIME_VOICE", "marin")
REALTIME_TRANSCRIBE = os.getenv("REALTIME_TRANSCRIBE", "gpt-live-transcribe")  # subtitles for the humans' speech
ROHLIK_MCP_URL = os.getenv("ROHLIK_MCP_URL", "https://mcp.rohlik.cz/mcp")
ROHLIK_TOKEN = os.getenv("ROHLIK_TOKEN", "")
DATA_DIR = Path(os.getenv("DATA_DIR", ROOT.parent / "data"))
STATE_FILE = DATA_DIR / "state.json"
MEMORY_DIR = ROOT / "memory"  # seeded by hand: instructions, household profile, product picks
NOTES_FILE = DATA_DIR / "notes.md"  # what the agent noted itself


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(vision.watch()) if camera.configured() else None
    refresh = asyncio.create_task(deals.refresh_forever())  # part 8: today's prices for C3, saved ahead
    yield
    refresh.cancel()
    if task:
        task.cancel()


app = FastAPI(title="Fridge Agent bridge", lifespan=lifespan)


# --------------------------------------------------------------------------- state


def _seed() -> dict[str, Any]:
    # HACK(demo): a believable fridge so the app has something to show before the cameras run.
    today = date.today()
    items = [
        ("Lactose-free milk", "1 l", 4, None),
        ("Greek yogurt", "1 cup", 1, "use tonight"),
        ("Eggs", "6", 12, None),
        ("Butter", "250 g", 30, None),
        ("Pecorino romano", "150 g", 20, None),
        ("Baby spinach", "1 bag", 2, None),
        ("Cherry tomatoes", "250 g", 5, None),
    ]
    return {
        "items": [
            {
                "id": uuid.uuid4().hex[:8],
                "name": name,
                "qty": qty,
                "expires": (today + timedelta(days=days)).isoformat(),
                "note": note,
                "added_at": time.time(),
            }
            for name, qty, days, note in items
        ],
        "cart": [],
        "approvals": {},
        "orders": [],
    }


def load_state() -> dict[str, Any]:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return _seed() if os.getenv("DEMO_SEED", "1") == "1" else _seed() | {"items": []}


STATE = load_state()


def save() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(STATE, indent=2, ensure_ascii=False))


# --------------------------------------------------------------------------- events (SSE)

_subscribers: set[asyncio.Queue[str]] = set()


def emit(kind: str, /, **data: Any) -> None:
    message = json.dumps({"type": kind, **data}, ensure_ascii=False)
    for queue in list(_subscribers):
        queue.put_nowait(message)


@app.get("/events")
async def events() -> StreamingResponse:
    queue: asyncio.Queue[str] = asyncio.Queue()
    _subscribers.add(queue)

    async def stream():
        try:
            yield "retry: 1000\n\n"
            while True:
                try:
                    yield f"data: {await asyncio.wait_for(queue.get(), timeout=15)}\n\n"
                except TimeoutError:
                    yield ": ping\n\n"
        finally:
            _subscribers.discard(queue)

    return StreamingResponse(stream(), media_type="text/event-stream")


@app.post("/events")
async def publish(request: Request) -> dict[str, Any]:
    """Anyone can put an event on the bus: the kitchen app's captions, the courier call, Telegram. See docs/handoffs."""
    event = await request.json()
    kind = event.pop("type")
    emit(kind, **event)
    if kind == "stage" and event.get("action") == "reset":
        reset()  # the stage reset hotkey resets the rehearsal data too
    return {"ok": True}


@app.post("/reset")
def reset() -> dict[str, Any]:
    """Rehearsal reset: the seed fridge, no cart, approvals, orders or notes. Keeps data/deals.json and data/vision."""
    STATE.clear()
    STATE.update(_seed())
    save()
    NOTES_FILE.unlink(missing_ok=True)
    emit("inventory", items=inventory(), source="reset")
    return {"ok": True}


@app.middleware("http")
async def tool_events(request: Request, call_next):
    """Every tool call goes on the bus, so the stage view follows whichever session made it."""
    if request.method != "POST" or not request.url.path.startswith("/tools/"):
        return await call_next(request)
    name = request.url.path.removeprefix("/tools/")
    args = json.loads(await request.body() or b"{}")
    screen = request.headers.get("x-coldex-screen")  # kitchen or stage, so the stage knows who called
    emit("tool", name=name, args=args, phase="start", screen=screen)
    response = await call_next(request)
    emit("tool", name=name, args=args, phase="done", ok=response.status_code < 400, screen=screen)
    return response


# --------------------------------------------------------------------------- inventory


class ItemIn(BaseModel):
    name: str
    qty: str | None = None
    expires: str | None = None  # YYYY-MM-DD
    note: str | None = None


class Changes(BaseModel):
    added: list[ItemIn] = []
    removed: list[ItemIn] = []
    source: str = "agent"


def _find(name: str) -> dict[str, Any] | None:
    key = name.strip().lower()
    return next((i for i in STATE["items"] if i["name"].lower() == key), None)


@app.get("/inventory")
def inventory() -> list[dict[str, Any]]:
    return sorted(STATE["items"], key=lambda i: i.get("expires") or "9999")


@app.post("/inventory/changes")
def inventory_changes(changes: Changes) -> dict[str, Any]:
    for item in changes.removed:
        found = _find(item.name)
        if found:
            STATE["items"].remove(found)
    for item in changes.added:
        found = _find(item.name)
        fields = item.model_dump(exclude_none=True)
        if found:
            found.update(fields)
        else:
            STATE["items"].append({"id": uuid.uuid4().hex[:8], "added_at": time.time(), **fields})
    save()
    emit("inventory", items=inventory(), source=changes.source)
    return {"ok": True, "items": inventory()}


# --------------------------------------------------------------------------- tools (Realtime function calls)


class Fact(BaseModel):
    fact: str
    category: str = "fact"


class CartItems(BaseModel):
    items: list[dict[str, Any]]


class Recipe(BaseModel):
    title: str
    have: list[str] = []
    missing: list[str] = []
    steps: list[str] = []


@app.post("/tools/get_inventory")
def tool_get_inventory() -> dict[str, Any]:
    return {"today": date.today().isoformat(), "items": inventory()}


@app.post("/tools/update_inventory")
def tool_update_inventory(changes: Changes) -> dict[str, Any]:
    return inventory_changes(changes)


def memory() -> str:
    """The household's markdown memory, read fresh every time so edits and new notes show up at once."""
    notes = NOTES_FILE.read_text() if NOTES_FILE.exists() else "- nothing yet\n"
    seeded = [(MEMORY_DIR / f).read_text() for f in ("household.md", "products.md")]
    return "\n\n".join([*seeded, show.deals_markdown(), f"# Notes\n\n{notes}"])


@app.post("/tools/get_household")
def tool_get_household() -> dict[str, Any]:
    return {"today": date.today().isoformat(), "memory": memory()}


@app.post("/tools/remember")
def tool_remember(body: Fact) -> dict[str, Any]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with NOTES_FILE.open("a") as f:
        f.write(f"- {datetime.now():%Y-%m-%d %H:%M} [{body.category}] {body.fact}\n")
    emit("learned", fact=body.fact, category=body.category)
    return {"ok": True}


@app.post("/tools/show_recipe")
def tool_show_recipe(recipe: Recipe) -> dict[str, Any]:
    emit("recipe", recipe=recipe.model_dump())
    return {"ok": True, "shown": True}


# HACK(demo): an in-memory cart for when no Rohlík token is set. With ROHLIK_TOKEN the model
# uses the real Rohlík MCP instead and these tools are not offered.
@app.post("/tools/add_to_cart")
def tool_add_to_cart(body: CartItems) -> dict[str, Any]:
    STATE["cart"].extend(body.items)
    save()
    total = sum(float(i.get("price_czk") or 0) * float(i.get("qty") or 1) for i in STATE["cart"])
    emit("cart", items=STATE["cart"], total_czk=round(total))
    return {"ok": True, "cart": STATE["cart"]}


@app.post("/tools/view_cart")
def tool_view_cart() -> dict[str, Any]:
    return {"cart": STATE["cart"]}


@app.post("/tools/place_order")
def tool_place_order() -> dict[str, Any]:
    """Never orders by itself. It opens an approval card, and only the human's tap places the order."""
    if not STATE["cart"]:
        return {"ok": False, "error": "The cart is empty."}
    total = sum(float(i.get("price_czk") or 0) * float(i.get("qty") or 1) for i in STATE["cart"])
    approval = {
        "id": secrets.token_hex(4),
        "items": list(STATE["cart"]),
        "total_czk": round(total),
        "status": "pending",
    }
    STATE["approvals"][approval["id"]] = approval
    save()
    emit("approval", approval=approval)
    return {"status": "waiting_for_approval", "approval_id": approval["id"], "total_czk": approval["total_czk"]}


class Decision(BaseModel):
    approved: bool


@app.post("/approvals/{approval_id}")
def decide(approval_id: str, decision: Decision) -> dict[str, Any]:
    approval = STATE["approvals"].get(approval_id)
    if approval is None or approval["status"] != "pending":
        raise HTTPException(404, "No pending approval with this id.")
    approval["status"] = "approved" if decision.approved else "declined"
    order = None
    if decision.approved:
        # HACK(demo): the fake cart "places" the order. The real one goes through Rohlík MCP approvals.
        order = {
            "id": f"R-{secrets.randbelow(900000) + 100000}",
            "items": approval["items"],
            "total_czk": approval["total_czk"],
        }
        STATE["orders"].append(order)
        STATE["cart"] = []
    save()
    emit("approval", approval=approval, order=order)
    return {"approval": approval, "order": order}


# --------------------------------------------------------------------------- camera


@app.get("/camera/{channel}.jpg")
async def camera_jpg(channel: int) -> Response:
    if not camera.configured():
        raise HTTPException(404, "No Reolink hub configured, the app falls back to the webcam.")
    try:
        return Response(await camera.snap(channel), media_type="image/jpeg", headers={"Cache-Control": "no-store"})
    except camera.CameraError as e:
        raise HTTPException(502, str(e)) from e


@app.post("/snapshot")
async def snapshot() -> dict[str, Any]:
    """Manual trigger. With the hub the bridge looks itself, without it the kitchen app sends a webcam frame."""
    if camera.configured():
        asyncio.create_task(vision.look_hub())
    else:
        emit("look", reason="manual")
    return {"ok": True}


# Beat B: the vision pipeline (bridge/vision.py) gets the bus and the inventory.
vision.attach(
    emit=emit,
    items=inventory,
    apply=lambda removed, added: inventory_changes(
        Changes(removed=[ItemIn(name=n) for n in removed], added=[ItemIn(**a) for a in added], source="vision")
    ),
)
app.include_router(vision.router)

# Beat F: the courier call (bridge/courier.py) publishes call phases and captions on the bus.
courier.attach(emit=emit)
app.include_router(courier.router)

# Beats B and C: the kitchen tablet's mic and Coldex's voice, relayed to the stage (bridge/kitchen_audio.py).
app.include_router(kitchen_audio.router)

# Beat H: Coldex posts what it does to the presenter's Telegram chat (bridge/telegram.py).
telegram.attach(_subscribers)
app.include_router(telegram.router)


# --------------------------------------------------------------------------- Realtime session


def session_config(rohlik: bool = True) -> dict[str, Any]:
    tools: list[dict[str, Any]] = [
        _fn("get_inventory", "What is in the fridge right now, with expiry dates.", {}),
        _fn(
            "update_inventory",
            "Record items added to or removed from the fridge.",
            {
                "added": {"type": "array", "items": _ITEM},
                "removed": {"type": "array", "items": _ITEM},
                "source": {"type": "string", "enum": ["vision", "agent"]},
            },
        ),
        _fn(
            "get_household",
            "A fresh copy of the household profile, product picks and your notes, including cravings.",
            {},
        ),
        _fn(
            "remember",
            "Note something about the household that every conversation should know.",
            {
                "fact": {"type": "string", "description": "One short sentence, e.g. 'Kryštof is craving carbonara tonight.'"},
                "category": {"type": "string", "enum": ["craving", "missing", "diet", "preference", "habit"]},
            },
            ["fact", "category"],
        ),
        _fn(
            "show_recipe",
            "Show a recipe card in the app.",
            {
                "title": {"type": "string"},
                "have": {"type": "array", "items": {"type": "string"}},
                "missing": {"type": "array", "items": {"type": "string"}},
                "steps": {"type": "array", "items": {"type": "string"}},
            },
            ["title"],
        ),
        *show.TOOLS,  # show_cart and show_shops, for the C3 and C4 cards
    ]
    if rohlik and ROHLIK_TOKEN:
        tools.append(
            {
                "type": "mcp",
                "server_label": "rohlik",
                "server_url": ROHLIK_MCP_URL,
                "authorization": ROHLIK_TOKEN,
                # Only search, read and cart tools exist for the session (rohlik.SAFE_TOOLS), so none of them
                # needs an approval round trip. Ordering is impossible here: a person completes it on rohlik.cz.
                "allowed_tools": SAFE_TOOLS,
                "require_approval": "never",
            }
        )
    else:
        # HACK(demo): no Rohlík token, so show_cart fills the fake cart (add_to_cart and view_cart only cost
        # the model extra rounds) and place_order puts it up for approval.
        tools.append(
            _fn(
                "place_order",
                "Ask the household to approve the cart. The order is placed only after they tap approve.",
                {},
            )
        )
    instructions = (MEMORY_DIR / "instructions.md").read_text()
    today = f"Today is {date.today():%A %d %B %Y}."
    return {
        "type": "realtime",
        "model": REALTIME_MODEL,
        "instructions": f"{instructions}\n{today}\n\n{memory()}",
        "audio": {
            "input": {"transcription": {"model": REALTIME_TRANSCRIBE, "language": "en"}},
            "output": {"voice": REALTIME_VOICE},
        },
        "tools": tools,
        "tool_choice": "auto",
    }


_ITEM = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "qty": {"type": "string"},
        "expires": {"type": "string", "description": "YYYY-MM-DD"},
        "note": {"type": "string"},
    },
    "required": ["name"],
}


def _fn(name: str, description: str, props: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {
        "type": "function",
        "name": name,
        "description": description,
        "parameters": {"type": "object", "properties": props, "required": required or []},
    }


import show  # noqa: E402  (it imports main back, so it comes after emit, STATE and _fn)

app.include_router(show.router)

import loop  # noqa: E402  (PLAN §6: records the bus, reviews itself, proposes memory edits a person approves)

app.include_router(loop.router)


@app.get("/realtime/token")
async def realtime_token() -> dict[str, Any]:
    if not OPENAI_API_KEY:
        raise HTTPException(503, "OPENAI_API_KEY is not set in bridge/.env.")
    async with httpx.AsyncClient(timeout=20) as client:

        async def mint(rohlik: bool) -> httpx.Response:
            return await client.post(
                "https://api.openai.com/v1/realtime/client_secrets",
                headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                json={"session": session_config(rohlik)},
            )

        res = await mint(rohlik=True)
        rohlik = bool(ROHLIK_TOKEN)
        if res.status_code != 200 and ROHLIK_TOKEN:
            # A stale Rohlík token must not keep the fridge from waking up. HACK(demo): fall back to the fake cart.
            emit("system", message=f"Rohlík MCP rejected, using the demo cart: {res.text[:200]}")
            res, rohlik = await mint(rohlik=False), False
    if res.status_code != 200:
        raise HTTPException(502, f"OpenAI: {res.text[:300]}")
    return {"value": res.json()["value"], "model": REALTIME_MODEL, "rohlik": rohlik}


@app.get("/config")
def config() -> dict[str, Any]:
    return {
        "model": REALTIME_MODEL,
        "openai": bool(OPENAI_API_KEY),
        "rohlik": bool(ROHLIK_TOKEN),
        "cameras": camera.CHANNELS if camera.configured() else [],
    }
