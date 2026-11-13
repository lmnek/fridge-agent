import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { grabFrames } from "./camera";
import { type Approval, Kitchen } from "./kitchen/Kitchen";
import { KitchenRelay } from "./kitchenAudio";
import { FridgeBrain, type Status } from "./realtime";
import { publish } from "./stage/bus";
import { publishCaption } from "./stage/captions";

const AWAKE = "coldex-awake"; // sessionStorage: this tab was woken, so it wakes again after a reload
let autoWoke = false; // StrictMode runs effects twice, and two sessions would answer twice

interface Item {
  id: string;
  name: string;
  qty?: string;
  expires?: string;
  note?: string;
}
interface Config {
  model: string;
  openai: boolean;
  rohlik: boolean;
  cameras: number[];
}
export default function App() {
  const [status, setStatus] = useState<Status>("off");
  const [caption, setCaption] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [learned, setLearned] = useState<string | null>(null);
  const [peek, setPeek] = useState<{ src: string; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);

  // The stage plays the kitchen through this relay, not through the video call (bridge/kitchen_audio.py).
  const relay = useMemo(() => new KitchenRelay(), []);
  const brain = useMemo(
    () =>
      new FridgeBrain({
        status: (st) => {
          setStatus(st);
          void publish({ type: "status", screen: "kitchen", status: st }); // the stage orb mirrors it
        },
        caption: (text, final, id) => {
          setCaption(text);
          publishCaption("coldex", `kitchen-${id ?? "r"}`, text, Boolean(final));
        },
        heard: (text, final, id) => publishCaption("actor", `kitchen-${id}`, text, final),
        approval: (req) => setApproval({ kind: "mcp", id: req.id, name: req.name, args: req.args }),
        error: setError,
        stream: (who, s) => void relay.attach(who, s),
      }),
    [relay],
  );
  const levels = useCallback(() => brain.levels(), [brain]);
  useEffect(() => {
    // Dev only: lets you drive the orb and captions from the console when rehearsing.
    if (import.meta.env.DEV) Object.assign(window, { __fridge: { brain, relay, setStatus, setCaption } });
  }, [brain, relay]);

  // Vision runs on the bridge (bridge/vision.py). Without a hub, the webcam frame goes there instead.
  const look = useCallback(async () => {
    try {
      setError(null);
      const frames = config?.cameras.length ? [] : await grabFrames([], 4_000_000);
      const res = await fetch("/api/vision/look", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frames }),
      });
      if (!res.ok) throw new Error((await res.json()).detail ?? `Vision: ${res.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [config]);
  const lookRef = useRef(look);
  lookRef.current = look;
  const hasHub = useRef(false);
  hasHub.current = !!config?.cameras.length;

  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then(setConfig).catch(() => setError("The bridge is not running on port 8100."));
    fetch("/api/inventory").then((r) => r.json()).then(setItems).catch(() => {});
    const es = new EventSource("/api/events");
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      if (ev.type === "inventory") setItems(ev.items);
      if (ev.type === "look" && ev.reason === "manual" && !hasHub.current) void lookRef.current();
      if (ev.type === "vision" && ev.phase === "captured") {
        const frame = ev.frames.find((f: { when: string }) => f.when === "after") ?? ev.frames[0];
        if (frame) setPeek({ src: frame.url, at: Date.now() });
      }
      if (ev.type === "vision" && ev.phase === "done" && ev.tell && brain.connected) {
        // The actor usually orders before the door closes, so the result lands mid-C: context only, no second reply.
        if (brain.activeWithin(45_000)) brain.note(ev.note);
        else brain.tell(ev.tell);
      }
      if (ev.type === "system") setError(ev.message);
      if (ev.type === "learned") {
        setLearned(ev.fact);
        setTimeout(() => setLearned((f) => (f === ev.fact ? null : f)), 7000);
      }
      if (ev.type === "approval") {
        const a = ev.approval;
        if (a.status === "pending") setApproval({ kind: "order", id: a.id, items: a.items, total: a.total_czk });
        else {
          setApproval((cur) => (cur?.id === a.id ? null : cur));
          if (ev.order) setCaption(`Order ${ev.order.id} is placed, ${ev.order.total_czk} Kč.`);
          if (brain.connected) {
            brain.tell(
              ev.order
                ? `[app] The household approved the order. Rohlík order ${ev.order.id} is placed, ${ev.order.total_czk} CZK.`
                : "[app] The household declined the order.",
            );
          }
        }
      }
    };
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => {
      es.close();
      clearInterval(timer);
    };
  }, [brain]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "l" && !(e.target instanceof HTMLInputElement)) void lookRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = async () => {
    // Wakes once and stays listening: a tap at the fridge mid-demo must not put Coldex to sleep. Reload to stop.
    if (status !== "off") return;
    setError(null);
    try {
      await brain.start();
      try {
        sessionStorage.setItem(AWAKE, "1");
      } catch {}
    } catch (e) {
      brain.stop();
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // A page reload (Vite reloads on every realtime.ts change, so on every git pull) used to leave Coldex asleep
  // until someone tapped again. Once woken, this tab wakes itself after a reload. If the browser blocks the
  // voice's autoplay without a gesture, the next tap or key anywhere plays it.
  useEffect(() => {
    let awake = false;
    try {
      awake = sessionStorage.getItem(AWAKE) === "1";
    } catch {}
    if (awake && !autoWoke) {
      autoWoke = true;
      void toggle();
    }
    const unblock = () => void brain.audio.play().catch(() => {});
    window.addEventListener("pointerdown", unblock);
    window.addEventListener("keydown", unblock);
    return () => {
      window.removeEventListener("pointerdown", unblock);
      window.removeEventListener("keydown", unblock);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brain]);

  const decide = async (ok: boolean) => {
    if (!approval) return;
    if (approval.kind === "mcp") {
      brain.approve(approval.id, ok);
      setApproval(null);
      return;
    }
    await fetch(`/api/approvals/${approval.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved: ok }),
    });
  };

  // Layout only (kitchen/Kitchen.tsx): the orb as the hero, one card at a time on the side.
  return (
    <Kitchen
      status={status}
      levels={levels}
      onWake={() => void toggle()}
      caption={caption}
      learned={learned}
      error={error}
      items={items}
      approval={approval}
      onDecide={(ok) => void decide(ok)}
      peek={peek}
      onLook={() => void look()}
    />
  );
}
