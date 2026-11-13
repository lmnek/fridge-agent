/**
 * The side panel: shows one card at a time, picked from the bus (pick.ts). Cards come from part 2's
 * `cards/index.ts` as soon as it exists, and from local placeholders until then.
 */
import { AnimatePresence, motion } from "motion/react";
import { type ComponentType, useEffect, useRef, useState } from "react";
import type { BusEvent } from "./bus";
import { Idle } from "./Idle";
import { type CardId, type PanelId, latestCard } from "./pick";
import { placeholders } from "./placeholders";

type CardMap = Record<CardId, ComponentType<{ events: BusEvent[] }>>;

// Part 2's cards, picked up automatically once app/src/stage/cards/index.ts lands on main (empty until then).
const part2 = Object.values(import.meta.glob<{ cards?: Partial<CardMap> }>("./cards/index.ts", { eager: true }))[0];
const cards: CardMap = { ...placeholders, ...(part2?.cards ?? {}) };

/** A card the agent asks for stays up at least this long, so a fast agent doesn't flash four cards in a second. */
const DWELL_MS = 2600;

/** The card to show: the newest one asked for, paced so each stays up for DWELL_MS. A forced beat cuts in. */
export function usePanelCard(events: BusEvent[]): PanelId {
  const { card: target, at, forced } = latestCard(events);
  const [shown, setShown] = useState<PanelId>(target);
  const shownAt = useRef(0);
  const queue = useRef<PanelId[]>([]);
  const [, wake] = useState(0);

  useEffect(() => {
    if (events.length === 0 || forced) {
      queue.current = [];
      shownAt.current = performance.now();
      setShown(target);
      return;
    }
    const last = queue.current.at(-1) ?? shown;
    if (target !== last) queue.current.push(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, at, forced, events.length === 0]);

  useEffect(() => {
    if (!queue.current.length) return;
    const wait = Math.max(0, DWELL_MS - (performance.now() - shownAt.current));
    const t = setTimeout(() => {
      // Skip ahead if the agent got far in front: keep at most the newest two.
      if (queue.current.length > 2) queue.current = queue.current.slice(-2);
      const next = queue.current.shift();
      if (next) {
        shownAt.current = performance.now();
        setShown(next);
      }
      wake((n) => n + 1);
    }, wait);
    return () => clearTimeout(t);
  });

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
