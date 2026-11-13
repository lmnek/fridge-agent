// Dev-only preview of the side panel cards, driven by the fixtures. Open /?cards (all cards) or
// /?cards=C4&t=70 (one card, 70 s into the run). Space plays and pauses, arrow keys step 1 s.
// /?cards=C4&live shows the card from the real bus (the bridge's SSE) instead of the fixtures.
// The panel box matches the stage layout: the orb in the left half, an 800x800 card centred in the right half, at 1920x1080.
import { useEffect, useMemo, useState } from "react";
import { cards, type CardId } from "./index";
import { latestCard } from "../pick";
import { useBus } from "../bus";
import { demoRun, eventsAt } from "./fixtures";

// The moment in the run where each card looks complete, for ?cards=<id> without t.
const SHOWCASE: Record<CardId, number> = { B: 38, C1: 47, C2: 70, C3: 70, C4: 75, DE: 93, F: 126, G: 150, PR: 0, NB: 0, OR: 0 };
const END = Math.max(...demoRun.map((e) => e.at)) / 1000;

export default function Preview() {
  const params = new URLSearchParams(location.search);
  const only = params.get("cards") as CardId | "" | "auto" | null;
  const [t, setT] = useState(() => Number(params.get("t") ?? (only && only in SHOWCASE ? SHOWCASE[only as CardId] : 0)));
  const [playing, setPlaying] = useState(params.has("play"));

  useEffect(() => {
    if (!playing) return;
    const start = performance.now() - t * 1000;
    let raf = 0;
    const tick = () => {
      const now = (performance.now() - start) / 1000;
      setT(Math.min(now, END));
      if (now < END) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") setPlaying((p) => !p);
      if (e.key === "ArrowRight") setT((x) => Math.min(END, x + 1));
      if (e.key === "ArrowLeft") setT((x) => Math.max(0, x - 1));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const live = useBus();
  const fixture = useMemo(() => eventsAt(t * 1000), [t]);
  const events = params.has("live") ? live : fixture;
  const ids = Object.keys(cards) as CardId[];
  const auto = only === "auto" ? latestCard(events).card : null;
  const shown: CardId | null = only === "auto" ? (auto === "idle" ? null : auto) : only && only in cards ? (only as CardId) : null;

  const controls = (
    <div style={{ position: "fixed", left: 16, bottom: 12, display: "flex", gap: 12, alignItems: "center", fontSize: 14, color: "#586a75", zIndex: 10 }}>
      <button onClick={() => setPlaying((p) => !p)}>{playing ? "pause" : "play"}</button>
      <input type="range" min={0} max={END} step={0.1} value={t} onChange={(e) => setT(Number(e.target.value))} style={{ width: 600 }} />
      <span style={{ width: 70 }}>{t.toFixed(1)} s</span>
      <span>{events.length} events</span>
      {ids.map((id) => (
        <a key={id} href={`?cards=${id}`}>
          {id}
        </a>
      ))}
      <a href="?cards=auto&play">auto</a>
      <a href="?cards">all</a>
    </div>
  );

  if (only === "" || only === null) {
    // Grid of every card at its showcase moment, each at its real 800x800 size (part 1 stage.css) scaled to half.
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 400px)", gap: 32, padding: 32, background: "#f3f6f7", minHeight: "100vh" }}>
        {ids.map((id) => {
          const Card = cards[id];
          return (
            <div key={id}>
              <a href={`?cards=${id}`} style={{ color: "#586a75", fontSize: 14 }}>
                {id} at {SHOWCASE[id]} s
              </a>
              <div style={{ width: 400, height: 400, marginTop: 6 }}>
                <div style={{ width: 800, height: 800, transform: "scale(0.5)", transformOrigin: "0 0" }}>
                  <Card events={eventsAt(SHOWCASE[id] * 1000)} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const Card = shown ? cards[shown] : null;
  return (
    <div style={{ width: 1920, height: 1080, background: "#f3f6f7", position: "relative", overflow: "hidden" }}>
      {/* stand-in for the orb and subtitles (part 1 and 9) */}
      <div style={{ position: "absolute", left: 0, top: 0, width: 960, height: 1080, display: "grid", placeItems: "center", color: "#8a9aa3", fontSize: 20 }}>
        <div style={{ width: 420, height: 420, borderRadius: "50%", border: "1px dashed #c4d1d7", display: "grid", placeItems: "center" }}>orb</div>
      </div>
      <div style={{ position: "absolute", left: 1040, top: 140, width: 800, height: 800 }}>{Card && <Card key={shown} events={events} />}</div>
      {controls}
    </div>
  );
}
