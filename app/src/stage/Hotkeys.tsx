/**
 * Stage hotkeys and their overlays (type the C line, cut to a clip, help, mic state). Owned by part 1, sub-task 3.
 * Press ? on the stage for the key map. Nothing here can place an order: the worst a key does is fill the bus.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { FridgeBrain } from "../realtime";
import { publish, useBus } from "./bus";
import { endCallAudio, startCourierCall } from "./call";
import { publishCaption } from "./captions";
import "./hotkeys.css";

const BEAT_KEYS: Record<string, string> = { "1": "A", "2": "B", "3": "C", "4": "DE", "5": "F", "6": "G", "7": "H" };
const C_LINE = "Let's order now, please.";

const HELP: [string, string][] = [
  ["D", "Door closed: replay the B frames"],
  ["M", "Stage mic on / off"],
  ["T", "Type the C line"],
  ["K", "Call the courier"],
  ["Shift K", "Fake courier call (scripted)"],
  ["1 – 7", "Force beat A, B, C, D/E, F, G, H"],
  ["Z / X", "Cut to the B / C clip"],
  ["Shift R", "Reset every screen"],
  ["?", "This help"],
];
const DEV_HELP: [string, string][] = [
  ["P", "Dev player: play / pause"],
  ["N", "Dev player: next event"],
  ["[ / ]", "Dev player: previous / next beat"],
];

type Clip = "b" | "c";

/** True while the user types into a field, so letters go to the field and not to the stage. */
export function typing(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

export function Hotkeys({ brain, wake }: { brain: FridgeBrain; wake: () => Promise<void> }) {
  const events = useBus();
  const [mic, setMic] = useState(brain.mic);
  const [toast, setToast] = useState<string | null>(null);
  const [typed, setTyped] = useState<string | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [help, setHelp] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const seen = useRef(0);

  const say = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // The mic can change outside this component (the call turns it off), so mirror it.
  useEffect(() => {
    const t = setInterval(() => setMic(brain.mic), 300);
    return () => clearInterval(t);
  }, [brain]);

  // Stop the call audio when the call ends.
  useEffect(() => {
    if (events.length < seen.current) seen.current = 0;
    for (let i = seen.current; i < events.length; i++) {
      if (events[i].type === "call" && events[i].phase === "ended") endCallAudio();
    }
    seen.current = events.length;
  }, [events]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      const lower = k.toLowerCase();

      if (k === "Escape") {
        setClip(null);
        setHelp(false);
        return;
      }
      if (k === "?" || k === "/") {
        setHelp((h) => !h);
        return;
      }
      if (BEAT_KEYS[k]) {
        void publish({ type: "stage", beat: BEAT_KEYS[k] });
        return;
      }
      if (e.shiftKey && lower === "r") {
        void publish({ type: "stage", action: "reset" });
        return;
      }
      if (e.shiftKey && lower === "k") {
        // HACK(demo): part 6's scripted courier call.
        startCourierCall(brain, true).catch((err) => say(String(err?.message ?? err)));
        return;
      }
      if (e.shiftKey) return;

      switch (lower) {
        case "d":
          fetch("/api/vision/replay?name=b", { method: "POST" })
            .then((r) => (r.ok ? say("Door closed: analysing") : say(`Door replay failed (${r.status})`)))
            .catch(() => say("Door replay failed: no bridge"));
          break;
        case "m":
          void (async () => {
            await wake();
            brain.setMic(!brain.mic);
            setMic(brain.mic);
          })();
          break;
        case "t":
          e.preventDefault(); // don't type the "t" into the field that opens
          setTyped(C_LINE);
          break;
        case "k":
          startCourierCall(brain).catch((err) => say(String(err?.message ?? err)));
          break;
        case "z":
        case "x": {
          const want: Clip = lower === "z" ? "b" : "c";
          setClip((c) => (c === want ? null : want));
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [brain, wake, say]);

  const send = async (text: string) => {
    setTyped(null);
    const line = text.trim();
    if (!line) return;
    publishCaption("presenter", `typed-${Date.now()}`, line, true);
    try {
      await wake();
      brain.tell(line);
    } catch (err) {
      say(`Could not send: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const dev = new URLSearchParams(location.search).has("dev");

  return (
    <>
      <div className={`hk-mic ${mic ? "is-live" : ""}`} data-mic={mic ? "live" : "off"}>
        <span className="hk-dot" />
        {mic ? "Mic live" : "Mic off"}
      </div>

      {toast ? (
        <div className="hk-toast" role="status">
          {toast}
        </div>
      ) : null}

      {typed !== null ? (
        <div className="hk-scrim" onClick={() => setTyped(null)}>
          <form
            className="hk-panel hk-type"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void send(typed);
            }}
          >
            <label className="hk-label" htmlFor="hk-line">
              Say to Coldex
            </label>
            <input
              id="hk-line"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setTyped(null);
              }}
            />
            <p className="hk-hint">Enter sends, Esc cancels</p>
          </form>
        </div>
      ) : null}

      {clip ? <ClipCut clip={clip} /> : null}

      {help ? (
        <div className="hk-scrim" onClick={() => setHelp(false)}>
          <div className="hk-panel hk-help" onClick={(e) => e.stopPropagation()}>
            <p className="hk-label">Stage keys</p>
            <dl>
              {[...HELP, ...(dev ? DEV_HELP : [])].map(([key, what]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** HACK(demo): fallback recordings, added by hand to app/public/demo/ (DEMO.md, Recordings). */
function ClipCut({ clip }: { clip: Clip }) {
  const [missing, setMissing] = useState(false);
  useEffect(() => setMissing(false), [clip]);
  return (
    <div className="hk-clip" data-clip={clip}>
      {missing ? (
        <p className="hk-clip-missing">{clip.toUpperCase()} clip missing</p>
      ) : (
        <video key={clip} src={`/demo/${clip}-clip.mp4`} autoPlay playsInline onError={() => setMissing(true)} />
      )}
    </div>
  );
}
