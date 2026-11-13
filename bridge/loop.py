"""The self-improving loop (PLAN §6): Coldex measures itself, proposes one edit to its own memory, and a person decides.

1. **Record.** The bus events that matter (tool calls, carts, approvals, learned facts, the stage reset) go to
   data/bus.jsonl with a timestamp. An order is a session (split at the stage reset or after 10 idle minutes)
   that put a cart on the panel. Its metrics: tool calls and seconds until the cart showed, tool calls repeated
   within the order, and whether a person changed the cart afterwards.
2. **Review.** One LLM call reads the orders since the last change, every past proposal with its measured result,
   and the memory files, and proposes one find/replace edit to bridge/memory/*.md with a reason and the metric it
   should move. It runs from the /loop page and on its own after every REVIEW_EVERY orders.
   HACK(demo): unless LOOP_LLM=1, a rule stands in for the call (the tool most often called twice gets a
   "call it once" line), so a review costs nothing.
3. **Approve.** Nothing changes until a person approves on /loop (or POST /loop/proposals/{id}). Then the edit is
   applied to the file, and the next Realtime session reads it.
4. **Measure.** The orders after the change against the orders before it, on the proposal's metric. The result goes
   into the next review as a signal.
"""

from __future__ import annotations

import difflib
import html
import json
import os
import secrets
import threading
import time
from collections import Counter
from datetime import datetime
from statistics import mean
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

import main as bridge  # main imports this module after emit and the bus exist

router = APIRouter()

BUS = bridge.DATA_DIR / "bus.jsonl"
STORE = bridge.DATA_DIR / "loop.json"
MEMORY_DIR = bridge.MEMORY_DIR
LLM = os.getenv("LOOP_LLM") == "1"
LOOP_MODEL = os.getenv("LOOP_MODEL", "gpt-5.5")
RECORDED = {"tool", "cart", "approval", "learned", "recipe", "stage"}
GAP_S = 600  # idle seconds that end a session
REVIEW_EVERY = 5  # orders since the last proposal before Coldex reviews itself unasked
MIN_AFTER = 3  # orders after a change before it gets a verdict
METRICS = {  # lower is better for every one
    "tool_calls": "tool calls per order",
    "seconds": "time to the cart",
    "repeats": "repeated tool calls per order",
    "corrected": "carts changed by a person",
}
_lock = threading.Lock()


# --------------------------------------------------------------------------- 1. record


class _Recorder:
    """Sits on the bus like an SSE client (main.emit calls put_nowait on every subscriber) and appends to the log."""

    def put_nowait(self, message: str) -> None:
        event = json.loads(message)
        if event["type"] not in RECORDED:
            return
        BUS.parent.mkdir(parents=True, exist_ok=True)
        with BUS.open("a") as f:
            f.write(json.dumps({"t": round(time.time(), 3), **event}, ensure_ascii=False) + "\n")
        if event["type"] == "cart":
            threading.Thread(target=_auto_review, daemon=True).start()


bridge._subscribers.add(_Recorder())  # type: ignore[arg-type]


def orders() -> list[dict[str, Any]]:
    events = [json.loads(line) for line in BUS.read_text().splitlines() if line.strip()] if BUS.exists() else []
    sessions: list[list[dict[str, Any]]] = [[]]
    for e in events:
        reset = e["type"] == "stage" and e.get("action") == "reset"
        if reset or (sessions[-1] and e["t"] - sessions[-1][-1]["t"] > GAP_S):
            sessions.append([])
        sessions[-1].append(e)
    return [o for s in sessions if (o := _order(s))]


def _order(session: list[dict[str, Any]]) -> dict[str, Any] | None:
    carts = [e for e in session if e["type"] == "cart"]
    if not carts:
        return None
    first = carts[0]
    calls = [e for e in session if e["type"] == "tool" and e.get("phase") == "start" and e["t"] <= first["t"]]
    tools = [c["name"] for c in calls]

    def lines(cart: dict[str, Any]) -> list[tuple[str, Any]]:
        return sorted((str(i.get("name")), i.get("qty")) for i in cart["items"])

    approvals = [e["approval"]["status"] for e in session if e["type"] == "approval"]
    return {
        "at": first["t"],
        "tools": tools,
        "tool_calls": len(tools),
        "seconds": round(first["t"] - calls[0]["t"], 1) if calls else 0.0,
        "repeats": len(tools) - len(set(tools)),
        "corrected": int(any(lines(c) != lines(first) for c in carts[1:])),
        "items": [i.get("name") for i in carts[-1]["items"]],
        "total_czk": carts[-1].get("total_czk"),
        "approval": approvals[-1] if approvals else None,
        "learned": [e["fact"] for e in session if e["type"] == "learned"],
    }


def summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {"orders": len(rows)} | {m: round(mean(r[m] for r in rows), 2) if rows else None for m in METRICS}


# --------------------------------------------------------------------------- store and measurement


def proposals() -> list[dict[str, Any]]:
    return json.loads(STORE.read_text()) if STORE.exists() else []


def _save(ps: list[dict[str, Any]]) -> None:
    STORE.parent.mkdir(parents=True, exist_ok=True)
    STORE.write_text(json.dumps(ps, indent=2, ensure_ascii=False))


def _cuts(ps: list[dict[str, Any]]) -> list[float]:
    return sorted(p["applied_at"] for p in ps if p.get("applied_at"))


def current(rows: list[dict[str, Any]], ps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The orders that ran on today's memory, since the last applied change."""
    since = max(_cuts(ps), default=0)
    return [r for r in rows if r["at"] >= since]


def measure(p: dict[str, Any], rows: list[dict[str, Any]], ps: list[dict[str, Any]]) -> dict[str, Any]:
    """Before: the orders since the previous change. After: the orders since this one, until the next."""
    a, cuts = p["applied_at"], _cuts(ps)
    prev = max((c for c in cuts if c < a), default=0)
    nxt = min((c for c in cuts if c > a), default=float("inf"))
    before = summary([r for r in rows if prev <= r["at"] < a])
    after = summary([r for r in rows if a <= r["at"] < nxt])
    b, f = before[p["metric"]], after[p["metric"]]
    if after["orders"] < MIN_AFTER or b is None:
        verdict = f"measuring, {after['orders']} of {MIN_AFTER} orders"
    else:
        tol = 0.05 * b
        verdict = "helped" if f < b - tol else "worse" if f > b + tol else "no change"
    return {"before": before, "after": after, "verdict": verdict}


# --------------------------------------------------------------------------- 2. review

PROMPT = """You improve Coldex, a voice agent that lives in a household's fridge: it notices what ran out, listens
to cravings and complaints, and fills the Rohlík cart that a person then completes. Its memory files below are its
whole prompt and knowledge.

You get the orders Coldex handled since its memory last changed, measured from its event bus, every change proposed
before with what it measured, and the memory files. Find the weakest spot in the numbers and propose exactly one
small edit to one memory file that should improve one metric.

- `find` is copied verbatim from the file and occurs in it exactly once. `replace` is the new text for it.
- `metric` is the one you expect to move. Lower is better for all of them: tool_calls (tool calls until the cart is
  on the panel), seconds (first tool call to the cart), repeats (tool calls repeating one already made in that
  order), corrected (share of orders whose cart a person changed after it was shown).
- `expected` is the value per order you expect once the change is in.
- `reason` is one or two plain sentences that cite the numbers.
- Don't propose a rejected change again, and build on the ones that helped.
- Never weaken the rule that a person completes every order, and keep the order narration's shape."""


def _schema() -> dict[str, Any]:
    props = {
        "file": {"type": "string", "enum": sorted(f.name for f in MEMORY_DIR.glob("*.md"))},
        "find": {"type": "string"},
        "replace": {"type": "string"},
        "reason": {"type": "string"},
        "metric": {"type": "string", "enum": list(METRICS)},
        "expected": {"type": "number"},
    }
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


def _llm(rows: list[dict[str, Any]], now: list[dict[str, Any]], ps: list[dict[str, Any]]) -> dict[str, Any]:
    """The one LLM call per review."""
    history = [
        {k: p.get(k) for k in ("file", "find", "replace", "reason", "metric", "expected", "status")}
        | ({"measured": measure(p, rows, ps)} if p.get("applied_at") else {})
        for p in ps
    ]
    context = "\n\n".join(
        [
            f"# Orders since the last change\n\nSummary: {json.dumps(summary(now))}\n\n"
            + "\n".join(json.dumps({k: v for k, v in r.items() if k != "at"}, ensure_ascii=False) for r in now[-20:]),
            f"# Changes so far\n\n{json.dumps(history, ensure_ascii=False, indent=1) if history else 'none yet'}",
            *(f"# Memory file {f.name}\n\n{f.read_text()}" for f in sorted(MEMORY_DIR.glob("*.md"))),
        ]
    )
    body = {
        "model": LOOP_MODEL,
        "instructions": PROMPT,
        "input": context,
        "text": {"format": {"type": "json_schema", "name": "proposal", "strict": True, "schema": _schema()}},
    }
    res = httpx.post(
        "https://api.openai.com/v1/responses",
        headers={"Authorization": f"Bearer {bridge.OPENAI_API_KEY}"},
        json=body,
        timeout=120,
    )
    if res.status_code != 200:
        raise HTTPException(502, f"Review ({LOOP_MODEL}): {res.text[:300]}")
    text = next(
        part["text"]
        for item in res.json().get("output", [])
        for part in item.get("content") or []
        if part.get("type") == "output_text"
    )
    return json.loads(text)


def _fake(now: list[dict[str, Any]], ps: list[dict[str, Any]]) -> dict[str, Any] | None:
    """HACK(demo): stands in for the LLM call. The tool most often called twice in one order gets a 'once' rule."""
    rejected = " ".join(p["replace"] for p in ps if p["status"] == "rejected")
    twice = Counter(t for r in now for t, n in Counter(r["tools"]).items() if n > 1 and t not in rejected)
    if not twice or twice.most_common(1)[0][1] < 2:
        return None
    tool, k = twice.most_common(1)[0]
    extra = sum(Counter(r["tools"])[tool] - 1 for r in now if tool in r["tools"]) / len(now)
    anchor = "## Ordering\n\n"
    return {
        "file": "instructions.md",
        "find": anchor,
        "replace": f"{anchor}Call {tool} at most once per order and reuse its answer: nothing it returns changes "
        'while you plan, and a "[camera]" message already tells you what did.\n\n',
        "reason": f"{tool} ran twice in {k} of the last {len(now)} orders, one more round trip before the cart "
        "showed each time.",
        "metric": "tool_calls",
        "expected": round(summary(now)["tool_calls"] - extra, 2),
    }


def review() -> dict[str, Any] | None:
    """Proposes one edit, or returns the one still waiting for a person. None when nothing is worth changing."""
    with _lock:
        ps = proposals()
        pending = next((p for p in ps if p["status"] == "pending"), None)
        if pending:
            return pending
        rows = orders()
        now = current(rows, ps)
        if not now:
            return None
        draft = _llm(rows, now, ps) if LLM else _fake(now, ps)
        if not draft:
            return None
        if (MEMORY_DIR / draft["file"]).read_text().count(draft["find"]) != 1:
            raise HTTPException(502, f"The proposed edit doesn't match {draft['file']} exactly once.")
        p = {"id": secrets.token_hex(3), "created_at": time.time(), "status": "pending", **draft}
        p["baseline"] = summary(now)
        _save([*ps, p])
    bridge.emit("loop", phase="proposed", proposal=p)
    return p


def _auto_review() -> None:
    """Self-driving: after every REVIEW_EVERY orders Coldex reviews itself, unless a proposal is still waiting."""
    ps = proposals()
    since = max((p["created_at"] for p in ps), default=0)
    if not any(p["status"] == "pending" for p in ps) and sum(r["at"] > since for r in orders()) >= REVIEW_EVERY:
        review()


# --------------------------------------------------------------------------- 3. approve, and the endpoints


class Decision(BaseModel):
    approved: bool


@router.post("/loop/review")
def post_review() -> dict[str, Any]:
    return {"proposal": review()}


@router.post("/loop/proposals/{pid}")
def decide(pid: str, decision: Decision) -> dict[str, Any]:
    """The human's call. Approving applies the edit to the memory file. Nothing else ever writes it."""
    with _lock:
        ps = proposals()
        p = next((p for p in ps if p["id"] == pid and p["status"] == "pending"), None)
        if p is None:
            raise HTTPException(404, "No pending proposal with this id.")
        if decision.approved:
            path = MEMORY_DIR / p["file"]
            text = path.read_text()
            if text.count(p["find"]) != 1:
                raise HTTPException(409, f"{p['file']} changed since the proposal. Reject it and review again.")
            path.write_text(text.replace(p["find"], p["replace"]))
            p["applied_at"] = time.time()
        p["status"] = "approved" if decision.approved else "rejected"
        p["decided_at"] = time.time()
        _save(ps)
    bridge.emit("loop", phase=p["status"], proposal=p)
    return p


@router.get("/loop/state")
def state() -> dict[str, Any]:
    rows, ps = orders(), proposals()
    return {
        "orders": rows,
        "now": summary(current(rows, ps)),
        "proposals": [p | ({"measured": measure(p, rows, ps)} if p.get("applied_at") else {}) for p in ps],
        "llm": LLM,
    }


# --------------------------------------------------------------------------- the page


def _fmt(metric: str, v: float | None) -> str:
    if v is None:
        return "–"
    return f"{v * 100:.0f} %" if metric == "corrected" else f"{v:.1f} s" if metric == "seconds" else f"{v:.1f}"


def _diff(p: dict[str, Any]) -> str:
    out = []
    for line in difflib.ndiff(p["find"].splitlines(), p["replace"].splitlines()):
        if not line[2:].strip():
            continue
        if line[0] in "+-":
            out.append(f'<div class="{"add" if line[0] == "+" else "del"}">{html.escape(line)}</div>')
        elif line[0] == " ":
            out.append(f"<div>{html.escape(line)}</div>")
    return f'<pre class="diff"><div class="file">bridge/memory/{html.escape(p["file"])}</div>{"".join(out)}</pre>'


def _clock(t: float) -> str:
    return datetime.fromtimestamp(t).strftime("%d. %m. %H:%M")


@router.get("/loop", response_class=HTMLResponse)
def page() -> str:
    s = state()
    rows, ps, now = s["orders"], s["proposals"], s["now"]
    tiles = "".join(
        f'<div class="tile"><b>{_fmt(m, now[m])}</b><span>{label}</span></div>' for m, label in METRICS.items()
    )

    applied = {p["applied_at"]: p for p in ps if p.get("applied_at")}
    marks = sorted(applied)

    def cut(at: float) -> str:
        return f'<tr class="cut"><td colspan="6">Change {applied[at]["id"]} applied {_clock(at)}</td></tr>'

    table = []
    for r in rows[-16:]:
        while marks and marks[0] <= r["at"]:
            table.append(cut(marks.pop(0)))
        seen: set[str] = set()
        tools = []
        for t in r["tools"]:
            tools.append(f'<em>{t}</em>' if t in seen else t)
            seen.add(t)
        table.append(
            f'<tr><td class="n">{_clock(r["at"])}</td><td class="n">{r["tool_calls"]}</td>'
            f'<td class="n">{r["seconds"]:.1f} s</td><td class="n">{r["repeats"]}</td>'
            f'<td>{"changed" if r["corrected"] else "kept"}</td>'
            f'<td class="tools">{" · ".join(tools)}</td></tr>'
        )
    table += [cut(m) for m in marks]  # changes with no orders after them yet

    pending = next((p for p in ps if p["status"] == "pending"), None)
    if pending:
        m, pid = pending["metric"], pending["id"]
        proposal = (
            f'<p class="why">{html.escape(pending["reason"])}</p>{_diff(pending)}'
            f'<p class="expect">{METRICS[m]}: {_fmt(m, pending["baseline"][m])} now, '
            f'expected {_fmt(m, pending["expected"])}</p>'
            f'<div class="actions"><button class="go" onclick="decide(\'{pid}\', true)">Approve and apply</button>'
            f'<button onclick="decide(\'{pid}\', false)">Reject</button></div>'
        )
    else:
        proposal = (
            f'<p class="why">Nothing waiting. Coldex reviews itself after every {REVIEW_EVERY} orders.</p>'
            '<div class="actions"><button onclick="post(\'loop/review\', {})">Review now</button></div>'
        )

    history = []
    for p in reversed([p for p in ps if p["status"] != "pending"]):
        m, x, numbers = p["metric"], p.get("measured"), ""
        if x:
            then = f'then <b>{_fmt(m, x["after"][m])}</b> over {x["after"]["orders"]}' if x["after"]["orders"] else ""
            result = (
                f'approved: {METRICS[m]} <b>{_fmt(m, x["before"][m])}</b> over {x["before"]["orders"]} orders {then}'
                f'<span class="verdict {x["verdict"].split(",")[0].replace(" ", "-")}">{x["verdict"]}</span>'
            )
            numbers = "".join(
                f'<tr><td>{label}</td><td class="n">{_fmt(k, x["before"][k])}</td>'
                f'<td class="n">{_fmt(k, x["after"][k])}</td></tr>'
                for k, label in METRICS.items()
            )
            numbers = f'<table class="ba"><tr><th></th><th>Before</th><th>After</th></tr>{numbers}</table>'
        else:
            result = f'rejected: {html.escape(p["reason"])}'
        history.append(
            f'<details><summary><span class="when">{_clock(p["decided_at"])}</span>{result}</summary>'
            f'<p class="why">{html.escape(p["reason"])}</p>{_diff(p)}{numbers}</details>'
        )

    mode = f"one {LOOP_MODEL} call per review" if s["llm"] else "the stand-in rule (HACK(demo), no LLM call)"
    return PAGE.format(
        tiles=tiles,
        count=len(rows),
        since=now["orders"],
        table="".join(table) or '<tr><td colspan="6">No orders recorded yet.</td></tr>',
        proposal=proposal,
        history="".join(history) or '<p class="why">No decisions yet.</p>',
        mode=mode,
    )


PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Coldex · learning loop</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Semi+Condensed:wght@500;600&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>
:root {{ --enamel:#f3f6f7; --frost:#dce5e9; --ink:#14222b; --slate:#586a75; --lamp:#1f6f96; --soon:#9a5b00; --gone:#b8283a; }}
* {{ box-sizing: border-box; }}
body {{ margin:0; background:var(--enamel); color:var(--ink); font:16px/1.45 Barlow, system-ui, sans-serif; -webkit-font-smoothing:antialiased; }}
main {{ max-width:1040px; margin:0 auto; padding:40px 32px 72px; }}
h1 {{ font:600 30px "Barlow Semi Condensed", Barlow, sans-serif; margin:0; letter-spacing:-0.01em; }}
h1 span {{ color:var(--slate); font-weight:500; }}
.lede {{ color:var(--slate); max-width:640px; margin:8px 0 40px; }}
h2 {{ font:600 13px Barlow, sans-serif; text-transform:uppercase; letter-spacing:0.08em; color:var(--slate); margin:44px 0 14px; }}
h2 small {{ text-transform:none; letter-spacing:0; font-weight:400; }}
.tiles {{ display:grid; grid-template-columns:repeat(4, 1fr); border-top:1px solid var(--frost); border-bottom:1px solid var(--frost); }}
.tile {{ padding:18px 0 16px; }}
.tile b {{ display:block; font:600 40px/1 "Barlow Semi Condensed", Barlow, sans-serif; font-variant-numeric:tabular-nums; }}
.tile span {{ color:var(--slate); font-size:14px; }}
table {{ width:100%; border-collapse:collapse; font-size:14px; }}
th {{ text-align:left; font-weight:500; color:var(--slate); padding:6px 12px 6px 0; border-bottom:1px solid var(--frost); }}
td {{ padding:7px 12px 7px 0; border-bottom:1px solid var(--frost); vertical-align:top; }}
td.n {{ font-variant-numeric:tabular-nums; white-space:nowrap; }}
td.tools {{ color:var(--slate); font-family:"JetBrains Mono", monospace; font-size:12px; }}
td.tools em {{ font-style:normal; color:var(--soon); font-weight:600; }}
tr.cut td {{ color:var(--lamp); font-weight:600; border-bottom:2px solid var(--lamp); padding-top:14px; }}
.card {{ background:#fff; border:1px solid var(--frost); border-radius:6px; padding:20px 24px; }}
.why {{ margin:0 0 14px; max-width:720px; }}
.expect {{ color:var(--slate); margin:14px 0 0; }}
pre.diff {{ margin:0; padding:12px 14px; background:var(--enamel); border-radius:4px; font:12.5px/1.6 "JetBrains Mono", monospace; white-space:pre-wrap; }}
pre.diff .file {{ color:var(--slate); margin-bottom:6px; }}
pre.diff .add {{ color:#1d6b3a; background:#e3f1e7; }}
pre.diff .del {{ color:var(--gone); background:#f8e4e6; }}
.actions {{ display:flex; gap:10px; margin-top:18px; }}
button {{ font:inherit; font-weight:500; padding:9px 18px; border-radius:4px; border:1px solid var(--frost); background:#fff; color:var(--ink); cursor:pointer; }}
button.go {{ background:var(--ink); color:#fff; border-color:var(--ink); }}
button:hover {{ border-color:var(--slate); }}
details {{ border-bottom:1px solid var(--frost); padding:12px 0; }}
details[open] summary {{ margin-bottom:12px; }}
summary {{ cursor:pointer; list-style:none; }}
summary .when {{ color:var(--slate); display:inline-block; width:120px; }}
.verdict {{ margin-left:10px; font-weight:600; }}
.verdict.helped {{ color:#1d6b3a; }} .verdict.worse, .verdict.rejected {{ color:var(--gone); }}
.verdict.no-change, .verdict.measuring {{ color:var(--soon); }}
table.ba {{ width:auto; margin-top:14px; }} table.ba td, table.ba th {{ padding-right:28px; }}
#err {{ color:var(--slate); min-height:1.4em; margin-top:10px; }}
footer {{ color:var(--slate); font-size:13px; margin-top:48px; }}
</style></head>
<body><main>
<h1>Coldex <span>learning loop</span></h1>
<p class="lede">Coldex records its own tool calls, carts and approvals, reviews the numbers, and proposes one change to its
memory at a time. Nothing changes until a person approves it, and every approved change is measured against the orders before it.</p>

<h2>Since the last change <small>{since} of {count} recorded orders</small></h2>
<div class="tiles">{tiles}</div>

<h2>Proposal</h2>
<div class="card">{proposal}<div id="err"></div></div>

<h2>Orders</h2>
<table><thead><tr><th>Cart shown</th><th>Calls</th><th>Time</th><th>Repeats</th><th>Cart</th><th>Tool calls until the cart (repeats marked)</th></tr></thead>
<tbody>{table}</tbody></table>

<h2>Decisions</h2>
{history}

<footer>Recorded from the bridge's event bus into data/bus.jsonl. Reviews use {mode}.</footer>
</main>
<script>
async function post(path, body) {{
  const res = await fetch(path, {{ method: "POST", headers: {{ "Content-Type": "application/json" }}, body: JSON.stringify(body) }});
  const data = await res.json();
  if (!res.ok) {{ document.getElementById("err").textContent = data.detail; return; }}
  if ("proposal" in data && !data.proposal) {{
    document.getElementById("err").textContent = "Nothing worth changing in the orders since the last change.";
    return;
  }}
  location.reload();
}}
function decide(id, approved) {{ post("loop/proposals/" + id, {{ approved }}); }}
</script>
</body></html>"""
