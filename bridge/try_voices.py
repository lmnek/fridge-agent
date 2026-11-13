"""Renders voice samples so a human can pick REALTIME_VOICE (and a personality) by ear.

Per voice and style it writes data/voices/fun/<voice>-<style>.wav in the main checkout: the C opener read
verbatim, ~0.6 s of silence, then a live judge Q&A answer ("What's about to expire?") from the real prompt.

    cd bridge && uv run python try_voices.py [--voices ballad,ash] [--styles plain,cheeky]
    cd bridge && uv run python try_voices.py --narration cedar   # only the C opener, to app/public/demo/c-narration.wav

Uses a throwaway data dir and the fake cart, like try_demo.py.
"""

import argparse
import asyncio
import base64
import json
import math
import os
import ssl
import struct
import sys
import tempfile
import wave
from pathlib import Path

os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="coldex-voices-")

import certifi  # noqa: E402
import websockets  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

bridge = TestClient(main.app)
ROOT = Path(__file__).resolve().parent.parent
OUT = Path("/home/lmnk/repos/fridge-agent/data/voices/fun")  # the main checkout, so it plays without a worktree
NARRATION = ROOT / "app" / "public" / "demo" / "c-narration.wav"
RATE = 24000
OPENER = ("Ordering three things. What just ran out: milk, lactose-free as always, and eggs, which carbonara needs anyway. "
          "For tonight: guanciale and spaghetti, with a gluten-free pack for Anna. And your weekly basics: yogurt, and "
          "bananas, which are on sale today. Lidl is 400 m away, but Rohlík delivers within the hour, so Rohlík. 685 Kč, ordering now.")
QUESTION = "What's about to expire?"
PERSONALITY = """## Personality

You are a dry, slightly cheeky fridge. Allow yourself at most one short quip per turn, a few words, after
the answer and never instead of it (the yogurt that keeps waiting, the milk that keeps vanishing). Never
quip in an order turn: the order narration keeps its exact shape. Keep it easy to follow in a noisy
room: short sentences, plain words.
"""

ap = argparse.ArgumentParser()
ap.add_argument("--voices", default="ballad,verse,ash,echo,shimmer,cedar,marin")
ap.add_argument("--styles", default="plain,cheeky")
ap.add_argument("--narration", metavar="VOICE", help="render only the C opener, plain, to app/public/demo/c-narration.wav")
ap.add_argument("--parallel", type=int, default=4)
ARGS = ap.parse_args()


def styled(instructions: str, style: str) -> str:
    """plain strips any ## Personality section; cheeky inserts ours after ## How you talk unless one exists."""
    has = "## Personality" in instructions
    if style == "plain" and has:
        start = instructions.index("## Personality")
        nxt = instructions.find("\n## ", start)
        return instructions[:start] + (instructions[nxt + 1:] if nxt != -1 else "")
    if style == "cheeky" and not has:
        talk = instructions.index("## How you talk")
        nxt = instructions.find("\n## ", talk)
        return instructions[:nxt + 1] + PERSONALITY + "\n" + instructions[nxt + 1:]
    return instructions


async def connect(voice: str, style: str, tools: bool):
    ws = await websockets.connect(
        f"wss://api.openai.com/v1/realtime?model={main.REALTIME_MODEL}",
        additional_headers={"Authorization": f"Bearer {main.OPENAI_API_KEY}"},
        max_size=None,
        ssl=ssl.create_default_context(cafile=certifi.where()),
    )
    session = main.session_config(rohlik=False)
    session.pop("model")
    session["instructions"] = styled(session["instructions"], style)
    session["audio"]["output"]["voice"] = voice
    if not tools:
        session["tools"] = []
    await ws.send(json.dumps({"type": "session.update", "session": session}))
    return ws


async def turn(ws, text: str) -> tuple[bytes, str]:
    """Sends one user message and runs the tool loop; returns all audio and the transcript."""
    item = {"type": "message", "role": "user", "content": [{"type": "input_text", "text": text}]}
    await ws.send(json.dumps({"type": "conversation.item.create", "item": item}))
    await ws.send(json.dumps({"type": "response.create"}))
    pcm, said = b"", [""]
    while True:
        ev = json.loads(await asyncio.wait_for(ws.recv(), 90))
        kind = ev["type"]
        if kind == "response.output_audio.delta":
            pcm += base64.b64decode(ev["delta"])
        elif kind == "response.output_audio_transcript.delta":
            said[-1] += ev["delta"]
        elif kind == "error":
            raise RuntimeError(ev["error"].get("message"))
        elif kind == "response.done":
            if ev["response"].get("status") == "failed":
                raise RuntimeError(json.dumps(ev["response"].get("status_details"))[:300])
            calls = [o for o in ev["response"].get("output", []) if o["type"] == "function_call"]
            if not calls:
                break
            for call in calls:
                result = bridge.post(f"/tools/{call['name']}", json=json.loads(call["arguments"] or "{}")).json()
                said[-1] += f" [{call['name']}]"
                out = {"type": "function_call_output", "call_id": call["call_id"], "output": json.dumps(result, ensure_ascii=False)}
                await ws.send(json.dumps({"type": "conversation.item.create", "item": out}))
            await ws.send(json.dumps({"type": "response.create"}))
            said.append("")
    return pcm, " | ".join(s.strip() for s in said if s.strip())


async def opener(voice: str, style: str) -> tuple[bytes, str]:
    ws = await connect(voice, style, tools=False)
    try:
        return await turn(ws, f"Read this aloud exactly, in your own voice: {OPENER}")
    finally:
        await ws.close()


async def qa(voice: str, style: str) -> tuple[bytes, str]:
    ws = await connect(voice, style, tools=True)
    try:
        return await turn(ws, QUESTION)
    finally:
        await ws.close()


def write(path: Path, pcm: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1), w.setsampwidth(2), w.setframerate(RATE), w.writeframes(pcm)


def level(pcm: bytes) -> tuple[float, float]:
    """Peak and RMS in dBFS."""
    s = struct.unpack(f"<{len(pcm) // 2}h", pcm[: len(pcm) // 2 * 2]) or (0,)
    peak = max(abs(x) for x in s) or 1
    rms = math.sqrt(sum(x * x for x in s) / len(s)) or 1
    return 20 * math.log10(peak / 32768), 20 * math.log10(rms / 32768)


async def render(voice: str, style: str, sem: asyncio.Semaphore) -> dict:
    async with sem:
        try:
            (op, op_said), (ans, ans_said) = await asyncio.gather(opener(voice, style), qa(voice, style))
        except Exception as e:  # an unsupported voice errors here; note it and carry on
            print(f"{voice}-{style}: ERROR {e}")
            return {"voice": voice, "style": style, "error": str(e)}
        pcm = op + b"\0" * (int(RATE * 0.6) * 2) + ans
        path = OUT / f"{voice}-{style}.wav"
        write(path, pcm)
        print(f"{path}  {len(pcm) / 2 / RATE:.1f}s\n  Q&A: {ans_said}")
        op_s = len(op) / 2 / RATE
        return {"voice": voice, "style": style, "total": len(pcm) / 2 / RATE, "op": op_s,
                "wps": len(OPENER.split()) / op_s if op_s else 0, "qa": len(ans) / 2 / RATE,
                "said": ans_said, "op_said": op_said, "level": level(pcm)}


async def run() -> None:
    sem = asyncio.Semaphore(ARGS.parallel)
    jobs = [render(v, s, sem) for v in ARGS.voices.split(",") for s in ARGS.styles.split(",")]
    rows = await asyncio.gather(*jobs)
    print(f"\n{'voice':<8} {'style':<7} {'total':>6} {'opener':>6} {'w/s':>5} {'Q&A':>5} {'peak':>6} {'rms':>6}  Q&A transcript")
    for r in rows:
        if "error" in r:
            print(f"{r['voice']:<8} {r['style']:<7} ERROR {r['error'][:100]}")
            continue
        print(f"{r['voice']:<8} {r['style']:<7} {r['total']:5.1f}s {r['op']:5.1f}s {r['wps']:5.2f} {r['qa']:4.1f}s "
              f"{r['level'][0]:5.1f}dB {r['level'][1]:5.1f}dB  {r['said'][:160]}")


async def narration(voice: str) -> None:
    pcm, said = await opener(voice, "plain")
    write(NARRATION, pcm)
    print(f"{NARRATION}  {len(pcm) / 2 / RATE:.1f}s  peak/rms {level(pcm)[0]:.1f}/{level(pcm)[1]:.1f} dBFS\n  {said}")


if __name__ == "__main__":
    if not main.OPENAI_API_KEY:
        sys.exit("Put OPENAI_API_KEY in bridge/.env first.")
    asyncio.run(narration(ARGS.narration) if ARGS.narration else run())
