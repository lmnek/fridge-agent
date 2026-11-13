"""Runs the learning loop (loop.py, PLAN §6) once end to end on recorded bus data: metrics, proposal, approval,
the edit applied, and the before/after measurement.

    cd bridge && uv run python try_loop.py [--serve 8108]

replay/loop/before.jsonl holds six demo orders in the recorder's shape, replay/loop/after.jsonl four more that
come after the change. HACK(demo): both are hand-made after try_demo's live runs (the lookups in parallel, the
vision diff landing mid-C), because live runs need the Realtime key. On the real bridge the recorder fills
data/bus.jsonl from every rehearsal instead. The review is the stand-in rule unless LOOP_LLM=1.

Uses a throwaway data dir and a copy of memory/, so it never touches the real ones. With --serve the page stays
up with the result: http://127.0.0.1:8108/loop
"""

import argparse
import json
import os
import shutil
import tempfile
import time
from pathlib import Path

os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="coldex-loop-")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

loop = main.loop  # main imports loop at its end, so loop never comes first
ROOT = Path(__file__).resolve().parent
ap = argparse.ArgumentParser()
ap.add_argument("--serve", type=int, help="keep the /loop page up on this port afterwards")
ap.add_argument("--pending", action="store_true", help="stop at the proposal, so a person approves it on the page")
ARGS = ap.parse_args()

loop.MEMORY_DIR = Path(tempfile.mkdtemp(prefix="coldex-memory-"))
for f in main.MEMORY_DIR.glob("*.md"):
    shutil.copy(f, loop.MEMORY_DIR)
bridge = TestClient(main.app)


def replay(name: str, start: float) -> None:
    """Appends a recorded log to data/bus.jsonl, shifted to start at `start`."""
    events = [json.loads(line) for line in (ROOT / "replay/loop" / name).read_text().splitlines()]
    with loop.BUS.open("a") as f:
        f.writelines(json.dumps({**e, "t": start + e["t"]}, ensure_ascii=False) + "\n" for e in events)


def show(title: str, s: dict) -> None:
    numbers = ", ".join(f"{label} {loop._fmt(m, s[m])}" for m, label in loop.METRICS.items())
    print(f"{title}: {s['orders']} orders, {numbers}")


loop.BUS.parent.mkdir(parents=True, exist_ok=True)
replay("before.jsonl", time.time() - 4 * 3600)
state = bridge.get("/loop/state").json()
print("1. Metrics")
for r in state["orders"]:
    print(f"   {r['tool_calls']} calls, {r['seconds']:5.1f} s, {r['repeats']} repeated: {' '.join(r['tools'])}")
show("   now", state["now"])

print("\n2. Review")
p = bridge.post("/loop/review").json()["proposal"]
print(f"   {p['reason']}\n   {p['file']}: + {p['replace'].strip().splitlines()[-1]}")
print(f"   expects {loop.METRICS[p['metric']]} {p['baseline'][p['metric']]} -> {p['expected']}")

if not ARGS.pending:
    print("\n3. A person approves")
    p = bridge.post(f"/loop/proposals/{p['id']}", json={"approved": True}).json()
    applied = p["replace"].strip() in (loop.MEMORY_DIR / p["file"]).read_text()
    print(f"   {p['status']}, applied to the copy of {p['file']}: {applied}")

    print("\n4. Orders after the change, then the measurement")
    replay("after.jsonl", p["applied_at"] + 60)
    x = next(q for q in bridge.get("/loop/state").json()["proposals"] if q["id"] == p["id"])["measured"]
    show("   before", x["before"])
    show("   after ", x["after"])
    print(f"   {loop.METRICS[p['metric']]}: {x['verdict']}")

if ARGS.serve:
    import uvicorn

    print(f"\nhttp://127.0.0.1:{ARGS.serve}/loop")
    uvicorn.run(main.app, port=ARGS.serve, log_level="warning")
