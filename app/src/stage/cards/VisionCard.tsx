// B analysis card: the vision pipeline as it runs. Frames captured, a calm scan while the model looks,
// detection boxes drawing in on their frames, then the diff ("Lactose-free milk  out"). A craving card drops in
// when Coldex remembers one. Driven by `vision` events (newest run only), then `learned` / `remember` craving.
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { BusEvent } from "../bus";
import { CardFrame, Steps, latest } from "./ui";
import "./VisionCard.css";

type Frame = { when: "before" | "after"; camera: string; url: string };
type Box = { frame: number; label: string; status: "out" | "new" | "in"; x: number; y: number; w: number; h: number };

const STEPS = ["Captured", "Analysing", "Detected", "Diff"];
const DIFF_DELAY = 1100; // ms after `done` before the diff lands, so the boxes get their moment first

const CAMERA_NAMES: Record<string, string> = { top: "Shelf camera", door: "Door camera" };
const cameraName = (c: string) => CAMERA_NAMES[c] ?? `${c[0]?.toUpperCase() ?? ""}${c.slice(1)} camera`;

const clock = (ts?: number) =>
  ts ? new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";

/** "Craving carbonara tonight" -> "Carbonara, tonight". Works off whatever fact text the agent stored. */
function craving(fact: string): string {
  let t = fact.trim().replace(/[.!]+$/, "");
  t = t.replace(/^(?:the household is |they are |i'?m |is )?(?:craving|craves|wants?|would love|fancies|in the mood for)\s+/i, "");
  const when = t.match(/\b(tonight|today|tomorrow|this weekend|for dinner|for lunch|this evening)\b/i)?.[1];
  if (when) t = t.replace(when, "").replace(/\s{2,}/g, " ").trim();
  const dish = t ? t[0].toUpperCase() + t.slice(1) : fact;
  return when ? `${dish}, ${when.toLowerCase()}` : dish;
}

/** Re-renders once `ms` has passed since `since`, and reports whether it has. */
function useAfter(since: number | undefined, ms: number): boolean {
  const passed = since !== undefined && Date.now() - since >= ms;
  const [, bump] = useState(0);
  useEffect(() => {
    if (since === undefined || passed) return;
    const id = setTimeout(() => bump((n) => n + 1), ms - (Date.now() - since) + 10);
    return () => clearTimeout(id);
  }, [since, ms, passed]);
  return passed;
}

function FrameTile({ frame, ts, boxes, scanning, delay }: { frame: Frame; ts?: number; boxes: Box[]; scanning: boolean; delay: number }) {
  // Context boxes ("in") first and quietly, then the ones that matter.
  const ordered = [...boxes].sort((a, b) => (a.status === "in" ? 0 : 1) - (b.status === "in" ? 0 : 1));
  return (
    <motion.figure
      className={`ck-vision-frame is-${frame.when}`}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 28, delay }}
    >
      {/* object-fit: fill keeps the 0..1 box coordinates on the right spot whatever the camera's aspect. */}
      <img src={frame.url} alt={`${cameraName(frame.camera)}, ${frame.when}`} />
      <span className="ck-vision-osd is-cam">{cameraName(frame.camera)}</span>
      <span className="ck-vision-osd is-when">
        {frame.when === "before" ? "Before" : "After"}
        {ts && frame.when === "after" ? <span className="ck-vision-clock">{clock(ts)}</span> : null}
      </span>
      {scanning && (
        <div className="ck-vision-scan" style={{ animationDelay: `${-delay * 4}s` }}>
          <i style={{ animationDelay: `${-delay * 4}s` }} />
        </div>
      )}
      {ordered.map((b, i) => (
        <motion.div
          key={`${b.label}-${i}`}
          className={`ck-vision-box is-${b.status}${b.y < 0.24 ? " label-inside" : ""}`}
          style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
          initial={{ opacity: 0, scale: b.status === "in" ? 1 : 1.25 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={
            b.status === "in"
              ? { duration: 0.4, delay: 0.1 + i * 0.06 }
              : { type: "spring", stiffness: 380, damping: 22, delay: 0.45 + i * 0.12 }
          }
        >
          {b.status !== "in" && <span className="ck-vision-label">{b.label}</span>}
        </motion.div>
      ))}
    </motion.figure>
  );
}

export default function VisionCard({ events }: { events: BusEvent[] }) {
  const newest = latest(events, "vision");
  const run = newest?.run;
  const ofRun = (phase: string) => latest(events, "vision", (e) => e.run === run && e.phase === phase);
  const captured = ofRun("captured");
  const done = ofRun("done");
  const phase: "waiting" | "captured" | "analysing" | "done" = !newest ? "waiting" : (done ? "done" : (newest.phase ?? "captured"));

  const frames: Frame[] = (done?.frames ?? captured?.frames ?? []) as Frame[];
  const boxes: Box[] = (done?.boxes ?? []) as Box[];
  const removed: string[] = done?.removed ?? [];
  const added: string[] = done?.added ?? [];
  const error: string | undefined = done?.error;
  const diffShown = useAfter(done?.ts, DIFF_DELAY) || (!!done && !done.ts);

  // The craving lands after the diff: the newest `learned` craving, or the `remember` call that stores it.
  const learned = latest(events, "learned", (e) => e.category === "craving");
  const remember = latest(events, "tool", (e) => e.name === "remember" && e.args?.category === "craving");
  const cravingFact: string | undefined = learned?.fact ?? remember?.args?.fact;

  // Frames laid out as a grid: one column per camera, before on top, after below.
  const cameras = [...new Set(frames.map((f) => f.camera))];
  const rows = (["before", "after"] as const).filter((w) => frames.some((f) => f.when === w));

  const at = phase === "waiting" ? -1 : phase === "captured" ? 1 : phase === "analysing" ? 1 : diffShown ? 3 : 2;
  const title =
    phase === "waiting"
      ? "Watching the fridge"
      : phase === "done"
        ? error
          ? "Couldn't read the frames"
          : removed.length + added.length === 0
            ? "Nothing changed"
            : removed.length && !added.length
              ? `${removed.length} ${removed.length === 1 ? "item" : "items"} taken out`
              : "Fridge changed"
        : phase === "analysing"
          ? "Looking for changes"
          : "Door closed";
  const aside =
    phase === "done" && typeof done?.seconds === "number"
      ? `${clock(captured?.ts ?? done.ts)}, read in ${done.seconds.toFixed(1)} s`
      : clock(captured?.ts);

  return (
    <CardFrame kicker="Fridge cameras" title={title} live={phase === "waiting" || phase === "analysing" || phase === "captured"} aside={aside}>
      <div className="ck-vision">
        <Steps steps={STEPS} at={at} done={phase === "done" && diffShown && !error} />

        {phase === "waiting" ? (
          <div className="ck-vision-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {["before", "after"].flatMap((w) =>
              ["top", "door"].map((c) => (
                <div key={`${w}-${c}`} className="ck-vision-frame is-idle">
                  <span className="ck-vision-osd is-cam">{cameraName(c)}</span>
                  <span className="ck-vision-osd is-when">{w === "before" ? "Standby" : ""}</span>
                </div>
              )),
            )}
            <p className="ck-vision-wait">Waiting for the door to close</p>
          </div>
        ) : (
          <div className="ck-vision-grid" style={{ gridTemplateColumns: `repeat(${Math.max(cameras.length, 1)}, 1fr)` }}>
            {rows.flatMap((when, r) =>
              cameras.map((camera, c) => {
                const idx = frames.findIndex((f) => f.when === when && f.camera === camera);
                if (idx < 0) return <div key={`${when}-${camera}`} />;
                return (
                  <FrameTile
                    key={`${run}-${when}-${camera}`}
                    frame={frames[idx]}
                    ts={captured?.ts}
                    boxes={phase === "done" ? boxes.filter((b) => b.frame === idx) : []}
                    scanning={phase === "analysing"}
                    delay={(r * cameras.length + c) * 0.08}
                  />
                );
              }),
            )}
          </div>
        )}

        <div className="ck-vision-bottom">
          {phase === "done" && diffShown && !error && (
            <motion.ul className="ck-vision-diff" initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.14 } } }}>
              {[...removed.map((n) => ({ n, s: "out" })), ...added.map((n) => ({ n, s: "new" }))].map(({ n, s }) => (
                <motion.li
                  key={`${s}-${n}`}
                  className={`is-${s}`}
                  variants={{
                    hidden: { opacity: 0, x: -28 },
                    show: { opacity: 1, x: 0, transition: { type: "spring", stiffness: 340, damping: 26 } },
                  }}
                >
                  <span className="ck-vision-name">{n}</span>
                  <span className="ck-vision-status">{s === "out" ? "out" : "new"}</span>
                </motion.li>
              ))}
              {removed.length + added.length === 0 && <li className="is-none">Everything is where it was.</li>}
            </motion.ul>
          )}
          {phase === "done" && error && (
            <p className="ck-vision-error">
              The cameras sent frames but vision could not read them: {error}. Coldex will ask what was taken.
            </p>
          )}
          {phase === "analysing" && <p className="ck-vision-note">Comparing before and after on both cameras</p>}
          {phase === "captured" && <p className="ck-vision-note">Frames in from {cameras.length} {cameras.length === 1 ? "camera" : "cameras"}</p>}

          <AnimatePresence>
            {cravingFact && (phase === "done" || phase === "waiting") && (
              <motion.div
                key={cravingFact}
                className="ck-vision-craving"
                initial={{ opacity: 0, y: 120, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 19, mass: 0.9 }}
              >
                <span className="ck-vision-craving-kicker">Craving noted</span>
                <span className="ck-vision-craving-dish">{craving(cravingFact)}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </CardFrame>
  );
}
