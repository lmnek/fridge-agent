/**
 * The kitchen page's layout (the tablet at the fridge). The orb is the hero, centred. The side shows one card
 * at a time, the one that's relevant right now, with the stage's cards and Panel switching (stage/Panel.tsx):
 * the agent's tool calls pick it, an inventory change brings up the fridge card (C1), and an order waiting for
 * a human's yes always wins. After IDLE_MS with nothing new, the card leaves and the orb glides back to the
 * centre, with a quiet one-line fridge status under it. App.tsx keeps every behaviour; this is layout only.
 */
import { KCaption } from "./KCaption";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Orb } from "../Orb";
import type { Levels } from "../orb/types";
import type { Status } from "../realtime";
import { type BusEvent, useBus } from "../stage/bus";
import { KitchenInset } from "../stage/KitchenInset";
import { Panel, usePanelCard } from "../stage/Panel";
import { cardFor } from "../stage/pick";
import { type Approval, ApprovalCard } from "./ApprovalCard";
import { ProductCard } from "./ProductCard";
import { NearbyCard } from "./NearbyCard";
import { OrderCard } from "./OrderCard";
import "./kitchen.css";

const CALL_GONE_MS = 3_000;

export type { Approval };

type Item = { id: string; name: string; qty?: string; expires?: string };

/** A card leaves this long after the last event that asked for one. */
const IDLE_MS = 40_000;
/** The stage cards are drawn for an 800x800 box on the projector; the side scales that box to fit. */
const CARD_W = 800;
const CARD_H = 800;

/** The orb's glide and the card's entrance: a soft spring that settles without a bounce. */
const SPRING = { type: "spring", stiffness: 120, damping: 22, mass: 1 } as const;

const STATUS_TEXT: Record<Status, string> = {
  off: "Tap the ice to wake me",
  connecting: "Waking up",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "",
};

export function Kitchen(props: {
  status: Status;
  levels: Levels;
  onWake: () => void;
  caption: string;
  learned: string | null;
  error: string | null;
  items: Item[];
  approval: Approval | null;
  onDecide: (ok: boolean) => void;
  peek: { src: string; at: number } | null;
  onLook: () => void;
  cam: boolean;
  inputLevel: () => number;
}) {
  const { status, caption, learned, error, approval, peek } = props;
  const { card, events } = useKitchenCard();
  const product = useFresh(events, "product", 9_000);
  const nearby = useFresh(events, "nearby", 14_000);
  const order = useFresh(events, "order", 12_000);
  const lastCall = events.findLast((e) => e.type === "call");
  const callTs = lastCall?.ts ?? 0; // a newer courier call wins over the quick cards
  // After hang-up the call card stays CALL_GONE_MS for the last words, then the side goes back to the orb.
  const callOver = lastCall?.phase === "ended" && Date.now() - callTs > CALL_GONE_MS;
  const [, tick] = useState(0);
  useEffect(() => {
    if (lastCall?.phase !== "ended") return;
    const t = setTimeout(() => tick((n) => n + 1), Math.max(0, callTs + CALL_GONE_MS - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [lastCall?.phase, callTs]);
  const newest = [product, nearby, order].filter(Boolean).sort((a, b) => (b?.ts ?? 0) - (a?.ts ?? 0))[0] ?? null;
  const quick = newest && (newest.ts ?? 0) > callTs ? newest : null;
  const side = approval ? "approval" : quick ? "quick" : card === "F" && callOver ? "idle" : card === "PR" || card === "NB" ? "idle" : card;
  // U: the fridge camera fills the side while no card shows, and shrinks to a PiP beside a card (as on /stage).
  const split = side !== "idle" || props.cam;

  return (
    <div className="kitchen" data-side={split ? "on" : "off"}>
      <header className="k-top">
        <span className="k-mark">
          <span className="mark-cube" aria-hidden>{"\u{1F9CA}"}</span>
          <span className="mark-name">Coldex</span>
        </span>
        <button type="button" className="peek" onClick={props.onLook} title="Look inside now (L)">
          {peek ? <img src={peek.src} alt="Last camera frame" /> : <span className="peek-empty" aria-hidden />}
          <span className="peek-text">{peek ? `Looked ${ago(peek.at)}` : "Look inside"}</span>
        </button>
      </header>

      {/* The orb's column: the whole width when idle, the left half while a card shows, so the orb glides from
          dead centre to the centre of the left half and stays big. */}
      <motion.main className="k-hero" initial={false} animate={{ width: split ? "50%" : "100%" }} transition={SPRING}>
        <Orb status={status} levels={props.levels} onToggle={props.onWake} />
        <div className="k-voice" aria-live="polite">
          {STATUS_TEXT[status] ? <p className="k-state">{STATUS_TEXT[status]}</p> : null}
          <KCaption text={caption} />
          {learned ? <p className="k-learned">Remembered: {learned}</p> : null}
          {error ? <p className="k-error">{error}</p> : null}
        </div>
        {/* No fridge status line here: the presenter wants only the orb, captions and cards. */}
      </motion.main>

      <AnimatePresence>
        {side !== "idle" ? (
          <motion.aside
            key="side"
            className="k-side"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0, transition: { ...SPRING, delay: 0.12, opacity: { duration: 0.42, ease: [0.2, 0, 0, 1], delay: 0.12 } } }}
            exit={{ opacity: 0, x: 24, transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }}
          >
            {approval ? (
              <div className="k-approval">
                <ApprovalCard approval={approval} onDecide={props.onDecide} />
              </div>
            ) : quick ? (
              <div className="k-approval">
                {quick.type === "nearby" ? (
                  <NearbyCard ev={quick} />
                ) : quick.type === "order" ? (
                  <OrderCard ev={quick} />
                ) : (
                  <ProductCard ev={quick} />
                )}
              </div>
            ) : (
              <Fit>
                <Panel card={card} events={events} />
              </Fit>
            )}
          </motion.aside>
        ) : null}
      </AnimatePresence>
      <KitchenInset
        size={!props.cam ? "hidden" : side === "idle" ? "large" : "pip"}
        muted={!props.cam}
        level={props.cam ? props.inputLevel : undefined}
      />
    </div>
  );
}

/**
 * The stage's card picking, plus two kitchen rules: an inventory change asks for the fridge card (C1), and
 * the card goes back to idle IDLE_MS after the last ask. Returns the card id and the bus for the cards.
 */
/** The newest event of a type while it's fresh: the quick cards (price, nearby shops) show for `ms`, then leave. */
function useFresh(events: BusEvent[], type: string, PRODUCT_MS: number) {
  const ev = events.findLast((e) => e.type === type);
  const [, rerender] = useState(0);
  const ts = ev?.ts ?? 0;
  useEffect(() => {
    const left = ts + PRODUCT_MS - Date.now();
    if (left <= 0) return;
    const t = setTimeout(() => rerender((n) => n + 1), left + 50);
    return () => clearTimeout(t);
  }, [ts]);
  return ev && Date.now() - ts < PRODUCT_MS ? ev : null;
}

function useKitchenCard() {
  const bus = useBus();
  const events = useMemo(() => {
    const out: BusEvent[] = [];
    for (const ev of bus) {
      out.push(ev);
      if (ev.type === "inventory") out.push({ type: "tool", name: "get_inventory", phase: "done", ts: ev.ts });
    }
    return out;
  }, [bus]);
  const shown = usePanelCard(events);
  const lastAsk = useMemo(() => events.findLast((ev) => cardFor(ev))?.ts ?? 0, [events]);

  const [, rerender] = useState(0);
  useEffect(() => {
    const left = lastAsk + IDLE_MS - Date.now();
    if (left <= 0) return;
    const t = setTimeout(() => rerender((n) => n + 1), left + 50);
    return () => clearTimeout(t);
  }, [lastAsk]);

  const fresh = lastAsk > 0 && Date.now() - lastAsk < IDLE_MS;
  // The cards read the bus as it is: the synthetic get_inventory asks only move the panel.
  return { card: fresh ? shown : ("idle" as const), events: bus };
}

/** Scales the stage's 800x800 card box to whatever the side has, centred. */
function Fit({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setK(Math.min(el.clientWidth / CARD_W, el.clientHeight / CARD_H)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="k-fit">
      <div className="k-fit-box" style={{ width: CARD_W, height: CARD_H, transform: `translate(-50%, -50%) scale(${k})` }}>
        {children}
      </div>
    </div>
  );
}

function ago(at: number): string {
  const min = Math.round((Date.now() - at) / 60_000);
  return min < 1 ? "just now" : min === 1 ? "a minute ago" : `${min} minutes ago`;
}
