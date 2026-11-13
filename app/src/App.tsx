import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { grabFrames } from "./camera";
import { Orb } from "./Orb";
import { FridgeBrain, type Status } from "./realtime";
import { publishCaption } from "./stage/captions";

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
interface Recipe {
  title: string;
  have: string[];
  missing: string[];
  steps: string[];
}
interface CartLine {
  name: string;
  qty?: number;
  price_czk?: number;
}
type Approval =
  | { kind: "order"; id: string; items: CartLine[]; total: number }
  | { kind: "mcp"; id: string; name: string; args: string };

const STATUS_TEXT: Record<Status, string> = {
  off: "Tap the ice to wake me",
  connecting: "Waking up",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "",
};

export default function App() {
  const [status, setStatus] = useState<Status>("off");
  const [caption, setCaption] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [learned, setLearned] = useState<string | null>(null);
  const [peek, setPeek] = useState<{ src: string; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);

  const brain = useMemo(
    () =>
      new FridgeBrain({
        status: setStatus,
        caption: (text, final, id) => {
          setCaption(text);
          publishCaption("coldex", `kitchen-${id ?? "r"}`, text, Boolean(final));
        },
        heard: (text, final, id) => publishCaption("actor", `kitchen-${id}`, text, final),
        approval: (req) => setApproval({ kind: "mcp", id: req.id, name: req.name, args: req.args }),
        error: setError,
      }),
    [],
  );
  const levels = useCallback(() => brain.levels(), [brain]);
  useEffect(() => {
    // Dev only: lets you drive the orb and captions from the console when rehearsing.
    if (import.meta.env.DEV) Object.assign(window, { __fridge: { brain, setStatus, setCaption } });
  }, [brain]);

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
      if (ev.type === "vision" && ev.phase === "done" && ev.tell && brain.connected) brain.tell(ev.tell);
      if (ev.type === "recipe") setRecipe(ev.recipe);
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
    if (status !== "off") return brain.stop();
    setError(null);
    try {
      await brain.start();
    } catch (e) {
      brain.stop();
      setError(e instanceof Error ? e.message : String(e));
    }
  };

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

  return (
    <div className="screen">
      <header className="top">
        <span className="mark">Coldex</span>
        <button type="button" className="peek" onClick={() => void look()} title="Look inside now (L)">
          {peek ? <img src={peek.src} alt="Last camera frame" /> : <span className="peek-empty" aria-hidden />}
          <span className="peek-text">{peek ? `Looked ${ago(peek.at)}` : "Look inside"}</span>
        </button>
      </header>

      <main className="stage">
        <Orb status={status} levels={levels} onToggle={() => void toggle()} />
        <div className="voice" aria-live="polite">
          {STATUS_TEXT[status] && <p className="state">{STATUS_TEXT[status]}</p>}
          {caption && <p className="caption">{caption}</p>}
          {learned && <p className="learned">Remembered: {learned}</p>}
          {error && <p className="error">{error}</p>}
        </div>
      </main>

      {(approval || recipe) && (
        <aside className="door">
          {approval ? <ApprovalCard approval={approval} onDecide={(ok) => void decide(ok)} /> : null}
          {!approval && recipe ? <RecipeCard recipe={recipe} onClose={() => setRecipe(null)} /> : null}
        </aside>
      )}

      <section className="inside" aria-labelledby="inside-title">
        <h2 id="inside-title">Inside</h2>
        {items.length === 0 ? (
          <p className="empty">Nothing yet. Close the door and I'll look.</p>
        ) : (
          chunk(items, 4).map((shelf, i) => (
            <ul className="shelf" key={i}>
              {shelf.map((item) => {
                const exp = expiry(item.expires);
                return (
                  <li key={item.id} className={exp.tone}>
                    <span className="name">{item.name}</span>
                    <span className="meta">
                      {item.qty && <span>{item.qty}</span>}
                      {exp.text && <span className="exp">{exp.text}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          ))
        )}
      </section>
    </div>
  );
}

function ApprovalCard({ approval, onDecide }: { approval: Approval; onDecide: (ok: boolean) => void }) {
  if (approval.kind === "mcp") {
    return (
      <div className="card">
        <h3>Rohlík needs your yes</h3>
        <p className="card-lead">Coldex wants to run {approval.name.replaceAll("_", " ")}.</p>
        <pre className="args">{prettyArgs(approval.args)}</pre>
        <div className="actions">
          <button type="button" className="primary" onClick={() => onDecide(true)}>
            Allow
          </button>
          <button type="button" onClick={() => onDecide(false)}>
            Not now
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="card">
      <h3>Order from Rohlík</h3>
      <ul className="lines">
        {approval.items.map((l, i) => (
          <li key={i}>
            <span>
              {l.name}
              {l.qty && l.qty !== 1 ? ` × ${l.qty}` : ""}
            </span>
            {l.price_czk ? <span className="num">{Math.round(l.price_czk * (l.qty ?? 1))} Kč</span> : null}
          </li>
        ))}
      </ul>
      <p className="total">
        <span>Total</span>
        <span className="num">{approval.total} Kč</span>
      </p>
      <div className="actions">
        <button type="button" className="primary" onClick={() => onDecide(true)}>
          Place order
        </button>
        <button type="button" onClick={() => onDecide(false)}>
          Not now
        </button>
      </div>
    </div>
  );
}

function RecipeCard({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  return (
    <div className="card">
      <h3>{recipe.title}</h3>
      {recipe.have.length > 0 && <p className="card-lead">From the fridge: {recipe.have.join(", ")}</p>}
      {recipe.missing.length > 0 && <p className="card-lead buy">To buy: {recipe.missing.join(", ")}</p>}
      {recipe.steps.length > 0 && (
        <ol className="steps">
          {recipe.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
      <div className="actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function chunk<T>(list: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));
}

function expiry(iso?: string): { text: string; tone: string } {
  if (!iso) return { text: "", tone: "" };
  const day = new Date(`${iso}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (Number.isNaN(days)) return { text: "", tone: "" };
  if (days < 0) return { text: "expired", tone: "gone" };
  if (days === 0) return { text: "use today", tone: "gone" };
  if (days === 1) return { text: "use tomorrow", tone: "soon" };
  if (days <= 3) return { text: `${days} days left`, tone: "soon" };
  return { text: `until ${day.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`, tone: "" };
}

function ago(at: number): string {
  const min = Math.round((Date.now() - at) / 60_000);
  return min < 1 ? "just now" : min === 1 ? "a minute ago" : `${min} minutes ago`;
}

function prettyArgs(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args), null, 2).slice(0, 600);
  } catch {
    return args.slice(0, 600);
  }
}
