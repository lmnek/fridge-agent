/**
 * The kitchen page's layout (the tablet at the fridge). The orb is the hero, centred. The side shows one card
 * at a time, the one that's relevant right now, with the stage's cards and Panel switching (stage/Panel.tsx):
 * the agent's tool calls pick it, an inventory change brings up the fridge card (C1), and an order waiting for
 * a human's yes always wins. After IDLE_MS with nothing new, the card leaves and the orb glides back to the
 * centre, with a quiet one-line fridge status under it. App.tsx keeps every behaviour; this is layout only.
 */
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Orb } from "../Orb";
import type { Levels } from "../orb/types";
import type { Status } from "../realtime";
import { type BusEvent, useBus } from "../stage/bus";
import { Panel, usePanelCard } from "../stage/Panel";
import { cardFor } from "../stage/pick";
import { type Approval, ApprovalCard } from "./ApprovalCard";
import "./kitchen.css";

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
}) {
  const { status, caption, learned, error, approval, peek } = props;
  const { card, events } = useKitchenCard();
  const side = approval ? "approval" : card;

  return (
    <div className="kitchen" data-side={side === "idle" ? "off" : "on"}>
      <header className="k-top">
        <span className="k-mark">
          <span className="mark-cube" aria-hidden>{"\u{1F9CA}"}</span>
          Coldex
        </span>
        <button type="button" className="peek" onClick={props.onLook} title="Look inside now (L)">
          {peek ? <img src={peek.src} alt="Last camera frame" /> : <span className="peek-empty" aria-hidden />}
          <span className="peek-text">{peek ? `Looked ${ago(peek.at)}` : "Look inside"}</span>
        </button>
      </header>

      {/* The orb's column: the whole width when idle, the left half while a card shows, so the orb glides from
          dead centre to the centre of the left half and stays big. */}
      <motion.main className="k-hero" initial={false} animate={{ width: side === "idle" ? "100%" : "50%" }} transition={SPRING}>
        <Orb status={status} levels={props.levels} onToggle={props.onWake} />
        <div className="k-voice" aria-live="polite">
          {STATUS_TEXT[status] ? <p className="k-state">{STATUS_TEXT[status]}</p> : null}
          {caption ? (
            <div className="k-caption">
              <p>{caption}</p>
            </div>
          ) : null}
          {learned ? <p className="k-learned">Remembered: {learned}</p> : null}
          {error ? <p className="k-error">{error}</p> : null}
        </div>
        <p className="k-fridge">{fridgeLine(props.items)}</p>
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
            ) : (
              <Fit>
                <Panel card={card} events={events} />
              </Fit>
            )}
          </motion.aside>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/**
 * The stage's card picking, plus two kitchen rules: an inventory change asks for the fridge card (C1), and
 * the card goes back to idle IDLE_MS after the last ask. Returns the card id and the bus for the cards.
 */
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

function fridgeLine(items: Item[]): string {
  if (items.length === 0) return "The fridge is empty. Close the door and I'll look.";
  const count = `${items.length} ${items.length === 1 ? "thing" : "things"} inside.`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const soon = items
    .filter((i) => i.expires)
    .map((i) => ({ name: i.name, days: Math.round((new Date(`${i.expires}T00:00:00`).getTime() - today.getTime()) / 86_400_000) }))
    .filter((i) => i.days >= 0 && i.days <= 2)
    .sort((a, b) => a.days - b.days)[0];
  if (!soon) return count;
  const when = soon.days === 0 ? "today" : soon.days === 1 ? "tomorrow" : `in ${soon.days} days`;
  return `${count} ${soon.name} goes off ${when}.`;
}

function ago(at: number): string {
  const min = Math.round((Date.now() - at) / 60_000);
  return min < 1 ? "just now" : min === 1 ? "a minute ago" : `${min} minutes ago`;
}
