"""Runs beats B and C as text against the real Realtime API, with no browser, mic or camera.

Prints what Coldex says, every tool call and the timing, so memory/instructions.md can be tuned in a loop:

    cd bridge && uv run python try_demo.py [--scenario NAME] [--runs N]

Scenarios (see SCENARIOS below): demo, no-camera, other-dish, other-missing, judge-craving, judge-edit.
After all runs it prints one summary row per run, which is what the prompt tuner reads.

Uses a throwaway data dir and the fake cart, so it never touches the real fridge state or Rohlík.
With --rohlik it uses the real Rohlík MCP instead and fills the household's real cart (never orders):

    cd bridge && uv run python try_demo.py --rohlik
"""

import argparse
import asyncio
import difflib
import json
import os
import ssl
import sys
import tempfile
import time

os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="coldex-try-")

import certifi  # noqa: E402
import websockets  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

bridge = TestClient(main.app)
ap = argparse.ArgumentParser()
ap.add_argument("--scenario", default="demo", choices=["demo", "no-camera", "other-dish", "other-missing", "judge-craving", "judge-edit"])
ap.add_argument("--runs", type=int, default=1)
ap.add_argument("--rohlik", action="store_true")
ARGS = ap.parse_args()
ROHLIK = ARGS.rohlik

# Capture the bus: main's functions call emit as a module global, so this has to be patched before any tool call.
EVENTS: list[tuple[float, str, dict]] = []
_orig_emit = main.emit
main.emit = lambda kind, /, **d: (EVENTS.append((time.monotonic(), kind, d)), _orig_emit(kind, **d))

# HACK(demo): stands in for the camera photos, which this script doesn't have.
CAMERA = "[camera] The fridge door just closed. Vision saw these taken out: {}. Update the inventory, then react briefly."
ORDER = "Let's order now, please."
B_LINE = "That was the last of the milk and the eggs."
B2_LINE = "They're going in the next order. Noted, carbonara."
C_LINE = ("Ordering three things. What just ran out: milk, lactose-free as always, and eggs, which carbonara needs anyway. "
          "For tonight: guanciale and spaghetti, with a gluten-free pack for Anna. And your weekly basics: yogurt, and "
          "bananas, which are on sale today. Lidl is 400 m away, but Rohlík delivers within the hour, so Rohlík. 812 Kč, ordering now.")
_cam = ("kitchen", "camera", CAMERA.format("Lactose-free milk, Eggs"), B_LINE)
_actor = ("kitchen", "actor", "Ugh, again. And I'm craving carbonara tonight.", B2_LINE)
_order = ("stage", "presenter", ORDER, C_LINE)

# name -> steps (session, who, text, expected). The stage session only learns the craving through get_household.
SCENARIOS = {
    "demo": [_cam, _actor, _order],
    "no-camera": [
        ("kitchen", "actor", "I just took the last of the milk and the eggs. Ugh, again. And I'm craving carbonara tonight.", B2_LINE),
        _order,
    ],
    "other-dish": [
        _cam,
        ("kitchen", "actor", "Ugh, again. And I really fancy pancakes tonight.", None),
        ("stage", "presenter", ORDER, None),
    ],
    "other-missing": [
        ("kitchen", "camera", CAMERA.format("Butter, Greek yogurt"), None),
        ("kitchen", "actor", "Out of butter again? And I'm craving carbonara tonight.", None),
        ("stage", "presenter", ORDER, None),
    ],
    "judge-craving": [_cam, _actor, _order, ("stage", "presenter", "Actually, make it tacos tonight instead. Let's order now.", None)],
    "judge-edit": [_cam, _actor, _order, ("stage", "presenter", "Drop the bananas, and make it two packs of guanciale.", None)],
}


async def connect():
    ws = await websockets.connect(
        f"wss://api.openai.com/v1/realtime?model={main.REALTIME_MODEL}",
        additional_headers={"Authorization": f"Bearer {main.OPENAI_API_KEY}"},
        max_size=None,
        ssl=ssl.create_default_context(cafile=certifi.where()),  # uv's Python on NixOS has no system CAs
    )
    session = main.session_config(rohlik=ROHLIK)
    session.pop("model")
    await ws.send(json.dumps({"type": "session.update", "session": session}))
    return ws


async def say(ws, who: str, text: str, expected: str | None) -> dict:
    print(f"\n\n>>> {who}: {text}\n")
    t0 = time.monotonic()
    first_word = None
    speech = [""]  # one string per response, to split what was said before the first tool call from what came after
    tools: list[str] = []
    pre_len = None  # number of responses up to and including the first one that called a tool
    item = {"type": "message", "role": "user", "content": [{"type": "input_text", "text": text}]}
    await ws.send(json.dumps({"type": "conversation.item.create", "item": item}))
    await ws.send(json.dumps({"type": "response.create"}))
    while True:
        ev = json.loads(await asyncio.wait_for(ws.recv(), 60))
        kind = ev["type"]
        if kind in ("response.output_audio_transcript.delta", "response.output_text.delta"):
            first_word = first_word or time.monotonic() - t0
            speech[-1] += ev["delta"]
            print(ev["delta"], end="", flush=True)
        elif kind == "error":
            print(f"\n[error] {ev['error'].get('message')}")
        elif kind == "response.done":
            output = ev["response"].get("output", [])
            for o in output:  # Rohlík MCP calls run on OpenAI's side, inside the same response
                if o["type"] == "mcp_call":
                    tools.append(f"rohlik.{o['name']}")
                    print(f"\n  [{time.monotonic() - t0:4.1f}s] rohlik.{o['name']} {o['arguments'][:160]}")
                    if o.get("error"):
                        print(f"  [rohlik error] {str(o['error'])[:300]}")
                elif o["type"] == "mcp_list_tools":
                    print(f"\n  [{time.monotonic() - t0:4.1f}s] rohlik tools: {len(o.get('tools', []))}")
            calls = [o for o in output if o["type"] == "function_call"]
            if (calls or tools) and pre_len is None:
                pre_len = len(speech)
            if not calls:
                break
            for call in calls:
                tools.append(call["name"])
                result = bridge.post(f"/tools/{call['name']}", json=json.loads(call["arguments"] or "{}")).json()
                print(f"\n  [{time.monotonic() - t0:4.1f}s] {call['name']} {call['arguments']}")
                output = {"type": "function_call_output", "call_id": call["call_id"], "output": json.dumps(result, ensure_ascii=False)}
                await ws.send(json.dumps({"type": "conversation.item.create", "item": output}))
            await ws.send(json.dumps({"type": "response.create"}))
            speech.append("")
    done = time.monotonic() - t0
    cut = pre_len or 0
    pre = " | ".join(s for s in speech[:cut] if s)
    post = " | ".join(s for s in speech[cut:] if s)
    sim = difflib.SequenceMatcher(None, " ".join(s for s in speech if s).lower(), expected.lower()).ratio() if expected else None
    print(f"\n  before first tool: {pre or '(nothing)'}\n  after: {post or '(nothing)'}")
    if sim is not None:
        print(f"  similarity to DEMO line: {sim:.2f}")
    print(f"  [first words {first_word or 0:.1f}s, done {done:.1f}s]")
    return {"first": first_word or 0.0, "done": done, "tools": tools, "sim": sim, "pre": pre}


def last_cart() -> tuple[list[dict], float]:
    """The last `cart` bus event (a list, or a dict with items and total_czk), else /tools/view_cart."""
    cart = next((d.get("cart", d.get("items")) for _, k, d in reversed(EVENTS) if k == "cart"), None)
    if cart is None:
        cart = bridge.post("/tools/view_cart").json()["cart"]
    items = cart.get("items", []) if isinstance(cart, dict) else cart
    total = cart.get("total_czk") if isinstance(cart, dict) else None
    if total is None:
        total = sum(float(i.get("price_czk") or 0) * float(i.get("qty") or 1) for i in items)
    return items, float(total)


async def one_run(n: int, steps: list[tuple]) -> dict | None:
    EVENTS.clear()
    main.STATE = main._seed()
    main.NOTES_FILE.unlink(missing_ok=True)
    print(f"\n\n{'=' * 20} run {n}: {ARGS.scenario} {'=' * 20}")
    sessions = {"stage": await connect(), "kitchen": await connect()}  # stage connects before B, like on stage
    try:
        results = [await say(sessions[s], who, text, exp) for s, who, text, exp in steps]
    finally:
        for ws in sessions.values():
            await ws.close()
    if ROHLIK:
        from rohlik import Rohlik

        async with Rohlik() as r:
            print(f"\n\nReal Rohlík cart:\n{json.dumps(await r.call('get_cart'), ensure_ascii=False)[:3000]}")
        return None
    items, total = last_cart()
    print("\n\nCart:")
    flagged = 0
    for i in items:
        bad = not i.get("reason") or i.get("price_czk") is None
        flagged += bad
        print(f"  {i.get('qty', 1):>4} x {i['name']:<28} {i.get('price_czk', '?'):>6} Kč  [{i.get('reason') or 'NO REASON'}]{'  <-- FLAG' if bad else ''}")
    print(f"  total {total:.0f} Kč")
    for _, k, d in EVENTS:
        if k in ("deals", "recipe"):
            print(f"\n{k}: {json.dumps(d, ensure_ascii=False)[:300]}")
    print(f"\nNotes:\n{(main.NOTES_FILE.read_text() if main.NOTES_FILE.exists() else '(none)')}")
    c = results[next(i for i, st in enumerate(steps) if st[0] == "stage")]  # C: the first step on the stage session
    return {"c": c, "n": len(items), "total": total, "flagged": flagged, "sims": [r["sim"] for r in results if r["sim"] is not None]}


async def run() -> None:
    steps = SCENARIOS[ARGS.scenario]
    rows = [await one_run(n, steps) for n in range(1, ARGS.runs + 1)]
    if ROHLIK:
        return
    print(f"\n\nSUMMARY  scenario={ARGS.scenario}  (C = first stage step; flagged = items without a reason or price)")
    print(f"{'run':>3} {'C done':>7} {'C 1st':>6} {'tools':>5} {'items':>5} {'total':>6} {'flagged':>7}  similarity (expected lines)")
    for n, r in enumerate(rows, 1):
        sims = " ".join(f"{s:.2f}" for s in r["sims"]) or "-"
        print(f"{n:>3} {r['c']['done']:6.1f}s {r['c']['first']:5.1f}s {len(r['c']['tools']):>5} {r['n']:>5} {r['total']:>6.0f} {r['flagged']:>7}  {sims}")
        print(f"      C tools: {', '.join(r['c']['tools']) or '(none)'}")
        print(f"      C said before first tool: {r['c']['pre'][:120] or '(nothing)'}")


if __name__ == "__main__":
    if not main.OPENAI_API_KEY:
        sys.exit("Put OPENAI_API_KEY in bridge/.env first.")
    asyncio.run(run())
