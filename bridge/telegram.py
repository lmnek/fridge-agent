"""Beat H: Coldex posts what it does to the presenter's Telegram chat (docs/handoffs/7-telegram.md, step 1).

Subscribes to the bus and turns the few events that matter into short messages in Coldex's voice: what ran
out, the craving, the cart, the order, the courier call and the delivery. One-way: nobody reads the replies.
Plain templates, no model call.

Live with TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in bridge/.env. Without them, HACK(demo): the fake chat
prints every message it would send and keeps it for GET /telegram.

    GET /telegram                  {"live": bool, "messages": [...]}, the chat since the last stage reset
    uv run python telegram.py      lists the chats that wrote to the bot (to find TELEGRAM_CHAT_ID), and with
                                   the id set, sends a test message
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from collections.abc import Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

_subscribers: set[Any] = set()  # main's bus subscribers, from attach()
sent: list[str] = []  # the chat since the last stage reset, live or fake


def attach(subscribers: set[Any]) -> None:
    global _subscribers
    _subscribers = subscribers


def live() -> bool:
    return bool(TOKEN and CHAT_ID)


# --------------------------------------------------------------------------- what Coldex says


def _join(names: list[str]) -> str:
    names = [n[:1].lower() + n[1:] if n[1:2].islower() else n for n in names]  # "Eggs" reads "eggs", "UHT" stays
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def _sentence(text: str) -> str:
    text = text.strip()
    return text if text.endswith((".", "!", "?")) else text + "."


def _kc(amount: Any) -> str:
    return f"{float(amount):,.0f} Kč".replace(",", " ")


class Chat:
    """One demo run's messages. A stage reset starts a new run, so each beat posts once per run."""

    def __init__(self) -> None:
        self.total: Any = None  # the last cart's total, for "order placed"
        self.ordered = False
        self.answered = False
        self.delivered = False

    def say(self, event: dict[str, Any]) -> str | None:
        kind = event.get("type")
        if kind == "stage" and event.get("action") == "reset":
            self.__init__()
            return None
        handler: Callable[[dict[str, Any]], str | None] | None = getattr(self, f"_{kind}", None)
        return handler(event) if handler else None

    def _vision(self, e: dict[str, Any]) -> str | None:
        removed = e.get("removed") or []
        if e.get("phase") != "done" or not removed:
            return None
        names, it = _join(removed), "it" if len(removed) == 1 else "them"
        return f"{names[:1].upper() + names[1:]} just ran out. I'll put {it} in the next order."

    def _learned(self, e: dict[str, Any]) -> str | None:
        fact = _sentence(e.get("fact") or "")
        if fact == ".":
            return None
        return {
            "craving": f"Noted. {fact} I'll plan the order around it.",
            "missing": f"Noted. {fact} It goes in the next order.",
        }.get(e.get("category", ""), f"{fact} I'll remember that.")

    def _cart(self, e: dict[str, Any]) -> str | None:
        items = e.get("items") or []
        if not items:
            return None
        self.total = e.get("total_czk")
        lines = [f"Your Rohlík cart is ready, {_kc(self.total or 0)}:", ""]
        for i in items:
            reason = f" ({i['reason']})" if i.get("reason") else ""
            lines.append(f"{float(i.get('qty') or 1):g} × {i.get('name', '')}{reason}")
        if e.get("checkout_url"):  # not agreed yet (handoffs README, part 3 update 5), so optional
            lines += ["", f"Check out here: {e['checkout_url']}"]
        return "\n".join(lines)

    def _approval(self, e: dict[str, Any]) -> str | None:
        approval = e.get("approval") or {}
        status, total = approval.get("status"), approval.get("total_czk")
        if status == "pending":
            return f"The cart is waiting for your OK in the app, {_kc(total or 0)}."
        if status == "declined":
            return "Okay, I won't order it."
        if status == "approved":
            self.total = (e.get("order") or {}).get("total_czk", total)
            return self._order_placed()
        return None

    def _stage(self, e: dict[str, Any]) -> str | None:
        beat = e.get("beat")
        if beat == "DE":
            return self._order_placed()
        if beat == "G" and not self.delivered:
            self.delivered = True
            return "Delivered. Enjoy dinner."
        return None

    def _order_placed(self) -> str | None:
        if self.ordered:
            return None
        self.ordered = True
        total = f", {_kc(self.total)}" if self.total else ""
        return f"Order placed{total}. The courier is on the way."

    def _call(self, e: dict[str, Any]) -> str | None:
        phase = e.get("phase")
        if phase == "dialing":
            self.answered = False
            return "Calling the courier to tell them where to bring it."
        if phase == "answered":
            self.answered = True
        if phase == "ended" and self.answered:
            self.answered = False
            return "Talked to the courier. They're on their way up."
        return None


# --------------------------------------------------------------------------- sending


async def send(client: httpx.AsyncClient, text: str) -> bool:
    if not live():
        print(f"[telegram, fake] {text}", flush=True)  # HACK(demo): no bot token yet, the fake chat
        return True
    try:
        res = await client.post(
            f"https://api.telegram.org/bot{TOKEN}/sendMessage",
            json={"chat_id": CHAT_ID, "text": text, "link_preview_options": {"is_disabled": True}},
        )
        if res.status_code == 200:
            return True
        print(f"[telegram] not sent: {res.json().get('description', res.status_code)}", flush=True)
    except httpx.HTTPError as e:
        print(f"[telegram] not sent: {type(e).__name__}", flush=True)  # never the URL, it carries the token
    return False


class _Inbox:
    """A bus subscriber. main.emit also runs in FastAPI's worker threads, so hand each event to the loop safely."""

    def __init__(self) -> None:
        self.loop = asyncio.get_running_loop()
        self.queue: asyncio.Queue[str] = asyncio.Queue()

    def put_nowait(self, message: str) -> None:
        self.loop.call_soon_threadsafe(self.queue.put_nowait, message)


async def forward(inbox: _Inbox) -> None:
    chat = Chat()
    async with httpx.AsyncClient(timeout=10) as client:
        while True:
            event = json.loads(await inbox.queue.get())
            if event.get("type") == "stage" and event.get("action") == "reset":
                sent.clear()
            text = chat.say(event)
            if text:
                sent.append(text)
                await send(client, text)


@asynccontextmanager
async def lifespan(_: Any):
    inbox = _Inbox()
    _subscribers.add(inbox)
    task = asyncio.create_task(forward(inbox))
    print(f"[telegram] {'live' if live() else 'fake (no TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)'}", flush=True)
    yield
    _subscribers.discard(inbox)
    task.cancel()


router = APIRouter(lifespan=lifespan)


@router.get("/telegram")
def chat() -> dict[str, Any]:
    return {"live": live(), "messages": sent}


# --------------------------------------------------------------------------- setup helper


async def _setup() -> None:
    if not TOKEN:
        sys.exit("Set TELEGRAM_BOT_TOKEN in bridge/.env first (docs/handoffs/7-telegram.md).")
    async with httpx.AsyncClient(timeout=10) as client:
        if CHAT_ID:
            ok = await send(client, "Coldex is connected. I'll post here what I do in the kitchen.")
            sys.exit(0 if ok else 1)
        res = (await client.get(f"https://api.telegram.org/bot{TOKEN}/getUpdates")).json()
        chats = {u["message"]["chat"]["id"]: u["message"]["chat"] for u in res.get("result", []) if "message" in u}
        if not chats:
            sys.exit("No chats yet. Open the bot in Telegram, tap Start, then run this again.")
        for chat_id, c in chats.items():
            print(f"TELEGRAM_CHAT_ID={chat_id}  # {c.get('first_name', '')} {c.get('username', '')}".rstrip())


if __name__ == "__main__":
    asyncio.run(_setup())
