/**
 * The side panel: shows one card at a time, picked from the bus (pick.ts). Cards come from part 2's
 * `cards/index.ts` as soon as it exists, and from local placeholders until then.
 */
import { AnimatePresence, motion } from "motion/react";
import { type ComponentType, useEffect, useRef, useState } from "react";
import type { BusEvent } from "./bus";
import { Idle } from "./Idle";
import { type CardId, type PanelId, cardFor, latestCard } from "./pick";
import { placeholders } from "./placeholders";

type CardMap = Record<CardId, ComponentType<{ events: BusEvent[] }>>;

// Part 2's cards, picked up automatically once app/src/stage/cards/index.ts lands on main (empty until then).
const part2 = Object.values(import.meta.glob<{ cards?: Partial<CardMap> }>("./cards/index.ts", { eager: true }))[0];
const cards: CardMap = { ...placeholders, ...(part2?.cards ?? {}) };

/** A card the agent asks for stays up at least this long, so a fast agent doesn't flash four cards in a second. */
const DWELL_MS = 2600;
/**
 * Cards asked for within BATCH_GAP_MS of each other came in one batch (part 3's C sends show_recipe, show_shops and
 * show_cart together, right before Coldex says the total). Each but the last holds only BATCH_DWELL_MS, so C2 and
 * C3 pass briskly and C4 is up while the total is spoken.
 */
const BATCH_DWELL_MS = 1500;
/** The quick answers (a price, the nearby shops) leave on their own after this long, as on the kitchen page. */
const QUICK_MS: Partial<Record<PanelId, number>> = { PR: 9_000, NB: 14_000, OR: 12_000 };
const BATCH_GAP_MS = 1000;

/**
 * The card to show: every card asked for, in order, paced by DWELL_MS. A forced beat cuts in, a reset clears all.
 *
 * The door's vision run lands a few seconds into C's narration (one kitchen session runs B and C), so:
 * - while a vision run is in progress (captured or analysing, no done or error yet) B holds and the C cards
 *   asked for wait in the queue, then play from the done on with the normal dwell;
 * - a vision run may take the panel to B (ahead of a queued C1) until a C2, C3 or C4 was asked for. From then
 *   on nothing B-asking moves the panel back to B. With no vision at all, C cards show straight away.
 */
export function usePanelCard(events: BusEvent[]): PanelId {
  const { card: target, at, forced } = latestCard(events);
  const [shown, setShown] = useState<PanelId>(target);
  const shownAt = useRef(0);
  const shownAsked = useRef(0); // when the shown card was asked for
  const queue = useRef<{ card: PanelId; asked: number }[]>([]);
  const scanned = useRef(0); // events already looked at
  const [, wake] = useState(0);

  const vision = useRef(false); // a vision run is in progress
  const lateC = useRef(false); // C2–C4 asked for: B never comes back until a forced beat or a reset

  useEffect(() => {
    if (events.length === 0 || forced || events.length < scanned.current) {
      queue.current = [];
      scanned.current = events.length;
      vision.current = lateC.current = false;
      shownAt.current = shownAsked.current = performance.now();
      setShown(target);
      return;
    }
    // Every card asked for since the last look, not only the newest: a batch can land in one render.
    let last = queue.current.at(-1)?.card ?? shown;
    for (let i = scanned.current; i < events.length; i++) {
      const ev = events[i];
      const card = cardFor(ev);
      if (!card) continue;
      if (card === "C2" || card === "C3" || card === "C4") lateC.current = true;
      if (card === "B" && lateC.current) continue; // never back to B in the middle of C
      if (ev.type === "vision") {
        const running = ev.phase === "captured" || ev.phase === "analysing";
        if (vision.current && !running) {
          // Done: the held C cards play from now, after the normal dwell.
          shownAt.current = performance.now();
          shownAsked.current = -Infinity;
        }
        vision.current = running;
        // B jumps ahead of a queued C1 for the analysis, once.
        queue.current = queue.current.filter((q) => q.card !== "B");
        if (shown !== "B") queue.current.unshift({ card, asked: performance.now() });
        last = queue.current.at(-1)?.card ?? shown;
        continue;
      }
      if (card !== last) queue.current.push({ card, asked: performance.now() });
      last = card;
    }
    if (lateC.current) vision.current = false;
    scanned.current = events.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, at, forced, events.length === 0]);

  useEffect(() => {
    const next = queue.current[0];
    if (!next) return;
    if (vision.current && next.card !== "B") return; // B holds while the vision run is in progress
    const hold = next.asked - shownAsked.current < BATCH_GAP_MS ? BATCH_DWELL_MS : DWELL_MS;
    const wait = Math.max(0, hold - (performance.now() - shownAt.current));
    const t = setTimeout(() => {
      // Skip ahead if the agent got far in front: keep at most the newest three.
      if (queue.current.length > 3) queue.current = queue.current.slice(-3);
      const step = queue.current.shift();
      if (step) {
        shownAt.current = performance.now();
        shownAsked.current = step.asked;
        setShown(step.card);
      }
      wake((n) => n + 1);
    }, wait);
    return () => clearTimeout(t);
  });

  useEffect(() => {
    const ms = QUICK_MS[shown];
    if (!ms) return;
    const t = setTimeout(() => {
      if (!queue.current.length) setShown("idle");
    }, ms);
    return () => clearTimeout(t);
  }, [shown]);

  return shown;
}

export function Panel({ card, events }: { card: PanelId; events: BusEvent[] }) {
  const Card = card === "idle" ? Idle : cards[card];
  return (
    <div className="panel" data-card={card}>
      {/* One switch for every card (part 2): the old card fades out, then the new one rises in and builds
          its content. The cards have no entrance of their own. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          className="panel-card"
          key={card}
          style={{ animation: "none" }}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.42, ease: [0.2, 0, 0, 1] } }}
          exit={{ opacity: 0, y: -6, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } }}
        >
          <Card events={events} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
