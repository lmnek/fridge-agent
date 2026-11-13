"""Runs beats B and C as text against the real Realtime API, with no browser, mic or camera.

Prints what Coldex says, every tool call and the timing, so memory/instructions.md can be tuned in a loop:

    cd bridge && uv run python try_demo.py [--scenario NAME] [--runs N]

Scenarios (see SCENARIOS below): demo, stage, no-camera, judge-qa, other-dish, other-missing, judge-craving,
judge-edit. `demo` is DEMO.md's B and C: the actor orders from the kitchen, and the vision diff lands mid-C
(--vision-at seconds after the actor's line) and goes in the way the kitchen page passes it on (note or tell).
`stage` is the fallback: the presenter types the order into the stage session.
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
ap.add_argument("--scenario", default="demo", choices=["demo", "stage", "no-camera", "judge-qa", "other-dish", "other-missing", "judge-craving", "judge-edit"])
ap.add_argument("--vision-at", type=float, default=6.0, help="demo: seconds after the actor's line when the vision diff lands (handoff 4: ~5.8 s analysis)")
ap.add_argument("--line", help="demo: what the actor says instead of DEMO.md's line")
ap.add_argument("--runs", type=int, default=1)
ap.add_argument("--rohlik", action="store_true")
ap.add_argument("--voices", help="comma-separated Realtime voices: saves data/voices/<voice>.wav of the B and C lines to listen to")
ARGS = ap.parse_args()
ROHLIK = ARGS.rohlik

# Capture the bus: main's functions call emit as a module global, so this has to be patched before any tool call.
EVENTS: list[tuple[float, str, dict]] = []
_orig_emit = main.emit
main.emit = lambda kind, /, **d: (EVENTS.append((time.monotonic(), kind, d)), _orig_emit(kind, **d))

# HACK(demo): stands in for the camera photos, which this script doesn't have. The wording is vision.tell_line's,
# and like vision.py the script applies the removal to the inventory before Coldex hears about it.
CAMERA = "[camera] The fridge door just closed. Vision saw these taken out: {}. The inventory is updated, react briefly."
CAM_REMOVED: dict[str, list[str]] = {}
ORDER = "Let's order now, please."
B_LINE = "That was the last of the milk and the eggs."
B2_LINE = "They're going in the next order. Noted, carbonara."
C_LINE = ("Ordering three things. What just ran out: milk, lactose-free as always, and eggs, which carbonara needs anyway. "
          "For tonight: guanciale and spaghetti, with a gluten-free pack for Anna. And your weekly basics: yogurt, and "
          "bananas, which are on sale today. Lidl is 400 m away, but Rohlík delivers within the hour, so Rohlík. 812 Kč, ordering now.")
def cam(*names: str, expected: str | None = B_LINE) -> tuple:
    text = CAMERA.format(", ".join(names))
    CAM_REMOVED[text] = list(names)
    return ("kitchen", "camera", text, expected)


KITCHEN = "Coldex, we're out of milk and eggs again and I'm craving carbonara, so order what we need."  # DEMO.md B
TAKEN = ["Lactose-free milk", "Eggs"]  # what the actor takes out in B
_cam = cam(*TAKEN)
_actor = ("kitchen", "actor", "Ugh, again. And I'm craving carbonara tonight.", B2_LINE)
_order = ("stage", "presenter", ORDER, C_LINE)

# name -> steps (session, who, text, expected[, vision]). vision = (seconds after the line, names taken out): the
# camera result arriving while that step runs. The stage session only learns the craving through get_household.
SCENARIOS = {
    "demo": [("kitchen", "actor", ARGS.line or KITCHEN, C_LINE, (ARGS.vision_at, TAKEN))],
    "stage": [_cam, _actor, _order],
    "no-camera": [  # DEMO's B without frames: the actor says what they took
        ("kitchen", "actor", "I just took the last milk and eggs.", B_LINE),
        _actor,
        _order,
    ],
    "judge-qa": [  # a judge talking to the fridge, off script, on the seeded fridge
        ("stage", "judge", "What's in my fridge?", None),
        ("stage", "judge", "What's about to expire?", None),
        ("stage", "judge", "What can I cook tonight?", None),
        ("stage", "judge", "Do I have everything for carbonara?", None),
    ],
    "other-dish": [
        _cam,
        ("kitchen", "actor", "Ugh, again. And I really fancy pancakes tonight.", None),
        ("stage", "presenter", ORDER, None),
    ],
    "other-missing": [
        cam("Butter", "Greek yogurt", expected=None),
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


async def say(ws, who: str, text: str, expected: str | None, vision: tuple[float, list[str]] | None = None) -> dict:
    print(f"\n\n>>> {who}: {text}\n")
    t0 = time.monotonic()
    first_word = None
    speech = [""]  # one string per response, to split what was said before the first tool call from what came after
    aud = [[None, 0.0]]  # per response: when its first audio arrived, and how many seconds of audio it has

    def next_response() -> None:
        speech.append("")
        aud.append([None, 0.0])

    tools: list[str] = []
    pre_len = None  # number of responses up to and including the first one that called a tool
    # Mirrors the kitchen page (App.tsx): busy or spoke in the last 45 s, the camera goes in as a note with no reply.
    st: dict = {"busy": True, "idle_at": None, "cam": None, "told": False, "extra": []}

    async def camera() -> None:  # vision.py's done event: apply the diff, then the kitchen page passes it on
        await asyncio.sleep(vision[0])
        bridge.post("/inventory/changes", json={"removed": [{"name": n} for n in vision[1]], "source": "vision"})
        st["cam"] = time.monotonic() - t0
        st["told"] = not st["busy"] and time.monotonic() - st["idle_at"] >= 45
        line = (main.vision.tell_line if st["told"] else main.vision.note_line)(vision[1], [])
        print(f"\n  [{st['cam']:4.1f}s] camera done, {'tell' if st['told'] else 'note'}: {line}")
        cam_item = {"type": "message", "role": "user", "content": [{"type": "input_text", "text": line}]}
        await ws.send(json.dumps({"type": "conversation.item.create", "item": cam_item}))
        if st["told"]:
            st["busy"] = True
            st["extra"].append(len(speech))
            next_response()
            await ws.send(json.dumps({"type": "response.create"}))

    cam_task = asyncio.create_task(camera()) if vision else None
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
        elif kind == "response.output_audio.delta":  # base64 PCM16 at 24 kHz
            aud[-1][0] = aud[-1][0] if aud[-1][0] is not None else time.monotonic() - t0
            aud[-1][1] += len(ev["delta"]) * 3 / 4 / 48000
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
                st["busy"], st["idle_at"] = False, time.monotonic()
                if cam_task and not cam_task.done():
                    await cam_task
                    if st["busy"]:
                        continue
                break
            for call in calls:
                tools.append(call["name"])
                result = bridge.post(f"/tools/{call['name']}", json=json.loads(call["arguments"] or "{}")).json()
                print(f"\n  [{time.monotonic() - t0:4.1f}s] {call['name']} {call['arguments']}")
                output = {"type": "function_call_output", "call_id": call["call_id"], "output": json.dumps(result, ensure_ascii=False)}
                await ws.send(json.dumps({"type": "conversation.item.create", "item": output}))
            await ws.send(json.dumps({"type": "response.create"}))
            next_response()
    done = time.monotonic() - t0
    # Dead air as the audience hears it: each response plays from when its audio arrives or the last one ends.
    heard, gaps = 0.0, []
    for start, secs in aud:
        if start is None or not secs:
            continue
        begin = max(start, heard)
        if heard:
            gaps.append(begin - heard)
        heard = begin + secs
    first_audio = next((a for a, secs in aud if a is not None and secs), 0.0)
    cut = pre_len or 0
    pre = " | ".join(s for s in speech[:cut] if s)
    post = " | ".join(s for s in speech[cut:] if s)
    sim = difflib.SequenceMatcher(None, " ".join(s for s in speech if s).lower(), expected.lower()).ratio() if expected else None
    print(f"\n  before first tool: {pre or '(nothing)'}\n  after: {post or '(nothing)'}")
    if sim is not None:
        print(f"  similarity to DEMO line: {sim:.2f}")
    extra = " | ".join(speech[i] for i in st["extra"] if speech[i]) or ("(silent)" if st["extra"] else "")
    if vision:
        print(f"  camera at {st['cam'] or 0:.1f}s, responses it started: {len(st['extra'])} {extra}")
    print(f"  [first words {first_word or 0:.1f}s, first audio {first_audio:.1f}s, done {done:.1f}s, "
          f"heard until {heard:.1f}s, silences {' '.join(f'{g:.1f}s' for g in gaps) or 'none'}]")
    return {"first": first_word or 0.0, "done": done, "tools": tools, "sim": sim, "pre": pre, "cam": st["cam"],
            "audio1": first_audio, "heard": heard, "gap": max(gaps, default=0.0),
            "told": st["told"], "extra": len(st["extra"]), "extra_text": extra}


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
    main.reset()  # the rehearsal reset: seed fridge, no cart, no notes, no order underway
    EVENTS.clear()
    print(f"\n\n{'=' * 20} run {n}: {ARGS.scenario} {'=' * 20}")
    sessions = {s: await connect() for s in ("stage", "kitchen") if any(st[0] == s for st in steps)}  # stage first, like on stage
    try:
        results = []
        for s, who, text, exp, *vision in steps:
            if text in CAM_REMOVED:  # vision.py updates the inventory before the session hears the camera line
                bridge.post("/inventory/changes", json={"removed": [{"name": n} for n in CAM_REMOVED[text]], "source": "vision"})
            results.append(await say(sessions[s], who, text, exp, *vision))
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
    c = next((r for r in results if "show_cart" in r["tools"]), results[-1])  # C: the first step that showed a cart
    return {"c": c, "n": len(items), "total": total, "flagged": flagged, "sims": [r["sim"] for r in results if r["sim"] is not None]}


async def run() -> None:
    steps = SCENARIOS[ARGS.scenario]
    rows = [await one_run(n, steps) for n in range(1, ARGS.runs + 1)]
    if ROHLIK:
        return
    print(f"\n\nSUMMARY  scenario={ARGS.scenario}  (C = first step with show_cart; flagged = items without a reason or price)")
    print(f"{'run':>3} {'C done':>7} {'C 1st':>6} {'heard':>6} {'gap':>5} {'tools':>5} {'items':>5} {'total':>6} {'flagged':>7}  similarity (expected lines)")
    for n, r in enumerate(rows, 1):
        sims = " ".join(f"{s:.2f}" for s in r["sims"]) or "-"
        c = r["c"]
        print(f"{n:>3} {c['done']:6.1f}s {c['audio1']:5.1f}s {c['heard']:5.1f}s {c['gap']:4.1f}s {len(c['tools']):>5} {r['n']:>5} {r['total']:>6.0f} {r['flagged']:>7}  {sims}")
        print(f"      C tools: {', '.join(r['c']['tools']) or '(none)'}")
        print(f"      C said before first tool: {r['c']['pre'][:120] or '(nothing)'}")
        if r["c"]["cam"] is not None:
            told = "tell, spoken reply" if r["c"]["told"] else "note, no reply asked"
            print(f"      camera at {r['c']['cam']:.1f}s ({told}), extra responses: {r['c']['extra']} {r['c']['extra_text'][:100]}")


async def voices(names: list[str]) -> None:
    """One WAV per voice, so a human can pick REALTIME_VOICE by ear."""
    import base64
    import wave
    from pathlib import Path

    out = Path(__file__).resolve().parent.parent / "data" / "voices"
    out.mkdir(parents=True, exist_ok=True)
    line = f"{B_LINE} {B2_LINE} {C_LINE}"
    for voice in names:
        ws = await connect()
        await ws.send(json.dumps({"type": "session.update", "session": {"type": "realtime", "tools": [], "audio": {"output": {"voice": voice}}}}))
        item = {"type": "message", "role": "user", "content": [{"type": "input_text", "text": f"Read this aloud exactly, in your own voice: {line}"}]}
        await ws.send(json.dumps({"type": "conversation.item.create", "item": item}))
        await ws.send(json.dumps({"type": "response.create"}))
        pcm = b""
        while (ev := json.loads(await asyncio.wait_for(ws.recv(), 60)))["type"] != "response.done":
            if ev["type"] == "response.output_audio.delta":
                pcm += base64.b64decode(ev["delta"])
        await ws.close()
        with wave.open(str(out / f"{voice}.wav"), "wb") as w:
            w.setnchannels(1), w.setsampwidth(2), w.setframerate(24000), w.writeframes(pcm)
        print(f"{out / voice}.wav  {len(pcm) / 48000:.1f}s")


if __name__ == "__main__":
    if not main.OPENAI_API_KEY:
        sys.exit("Put OPENAI_API_KEY in bridge/.env first.")
    asyncio.run(voices(ARGS.voices.split(",")) if ARGS.voices else run())
