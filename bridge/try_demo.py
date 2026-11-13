"""Runs beats B and C as text against the real Realtime API, with no browser, mic or camera.

Prints what Coldex says, every tool call and the timing, so memory/instructions.md can be tuned in a loop:

    cd bridge && uv run python try_demo.py

Uses a throwaway data dir and the fake cart, so it never touches the real fridge state or Rohlík.
"""

import asyncio
import json
import os
import sys
import tempfile
import time

os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="coldex-try-")

import websockets  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

bridge = TestClient(main.app)


async def connect():
    ws = await websockets.connect(
        f"wss://api.openai.com/v1/realtime?model={main.REALTIME_MODEL}",
        additional_headers={"Authorization": f"Bearer {main.OPENAI_API_KEY}"},
        max_size=None,
    )
    session = main.session_config(rohlik=False)
    session.pop("model")
    await ws.send(json.dumps({"type": "session.update", "session": session}))
    return ws


async def say(ws, who: str, text: str) -> None:
    print(f"\n\n>>> {who}: {text}\n")
    t0 = time.monotonic()
    first_word = None
    item = {"type": "message", "role": "user", "content": [{"type": "input_text", "text": text}]}
    await ws.send(json.dumps({"type": "conversation.item.create", "item": item}))
    await ws.send(json.dumps({"type": "response.create"}))
    while True:
        ev = json.loads(await asyncio.wait_for(ws.recv(), 60))
        kind = ev["type"]
        if kind in ("response.output_audio_transcript.delta", "response.output_text.delta"):
            first_word = first_word or time.monotonic() - t0
            print(ev["delta"], end="", flush=True)
        elif kind == "error":
            print(f"\n[error] {ev['error'].get('message')}")
        elif kind == "response.done":
            calls = [o for o in ev["response"].get("output", []) if o["type"] == "function_call"]
            if not calls:
                break
            for call in calls:
                result = bridge.post(f"/tools/{call['name']}", json=json.loads(call["arguments"] or "{}")).json()
                print(f"\n  [{time.monotonic() - t0:4.1f}s] {call['name']} {call['arguments']}")
                output = {"type": "function_call_output", "call_id": call["call_id"], "output": json.dumps(result, ensure_ascii=False)}
                await ws.send(json.dumps({"type": "conversation.item.create", "item": output}))
            await ws.send(json.dumps({"type": "response.create"}))
    print(f"\n  [first words {first_word or 0:.1f}s, done {time.monotonic() - t0:.1f}s]")


async def run() -> None:
    stage = await connect()  # starts before B, like on stage, so it has to find the craving through get_household
    kitchen = await connect()
    # HACK(demo): stands in for the camera photos, which this script doesn't have.
    await say(kitchen, "camera", "[camera] The fridge door just closed. Vision saw these taken out: Lactose-free milk, Eggs. "
              "Update the inventory, then react briefly.")
    await say(kitchen, "actor", "Ugh, again. And I'm craving carbonara tonight.")
    await say(stage, "presenter", "Let's order now, please.")
    cart = bridge.post("/tools/view_cart").json()["cart"]
    total = sum(float(i.get("price_czk") or 0) * float(i.get("qty") or 1) for i in cart)
    print("\n\nCart:")
    for i in cart:
        print(f"  {i.get('qty', 1):>4} x {i['name']:<28} {i.get('price_czk', '?'):>6} Kč  [{i.get('reason', 'NO REASON')}]")
    print(f"  total {total:.0f} Kč, {'clears' if total >= 749 else 'BELOW'} the 749 Kč minimum")
    print(f"\nNotes:\n{(main.NOTES_FILE.read_text() if main.NOTES_FILE.exists() else '(none)')}")


if __name__ == "__main__":
    if not main.OPENAI_API_KEY:
        sys.exit("Put OPENAI_API_KEY in bridge/.env first.")
    asyncio.run(run())
