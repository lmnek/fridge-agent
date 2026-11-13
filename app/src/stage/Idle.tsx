/** The idle panel (beats A and H): Coldex at rest, with a quiet fridge summary. Owned by part 1. */
import { useEffect, useState } from "react";
import type { BusEvent } from "./bus";

type Item = { id: string; name: string; qty?: string | null; expires?: string | null; note?: string | null };

const DAY = 86_400_000;

/** Whole days from today to `iso` (YYYY-MM-DD), in local time. */
function daysLeft(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / DAY);
}

function when(days: number): string {
  if (days < 0) return "expired";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export function Idle({ events }: { events: BusEvent[] }) {
  const [fetched, setFetched] = useState<Item[] | null>(null);

  useEffect(() => {
    fetch("/api/inventory")
      .then((r) => (r.ok ? r.json() : null))
      .then((items) => Array.isArray(items) && setFetched(items))
      .catch(() => {});
  }, []);

  const pushed = events.findLast((e) => e.type === "inventory" && Array.isArray(e.items));
  const items: Item[] = pushed ? pushed.items : (fetched ?? []);

  const dated = items
    .filter((i) => i.expires)
    .map((i) => ({ ...i, days: daysLeft(i.expires!) }))
    .sort((a, b) => a.days - b.days);
  const soon = dated.filter((i) => i.days <= 2);
  const soonIds = new Set(soon.map((i) => i.id));
  const rest = items.filter((i) => !soonIds.has(i.id));

  return (
    <div className="idle">
      <p className="idle-count">
        <span className="idle-num">{items.length}</span> {items.length === 1 ? "item" : "items"} in the fridge
      </p>

      {soon.length ? (
        <section className="idle-soon">
          <h3 className="idle-head">Use soon</h3>
          <ul>
            {soon.map((i) => (
              <li key={i.id} data-gone={i.days < 0 || undefined}>
                <span className="idle-name">{i.name}</span>
                <span className="idle-when">{when(i.days)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {rest.length ? (
        <section className="idle-rest">
          <h3 className="idle-head">Also inside</h3>
          <ul>
            {rest.map((i) => (
              <li key={i.id}>
                <span className="idle-name">{i.name}</span>
                {i.qty ? <span className="idle-qty">{i.qty}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
