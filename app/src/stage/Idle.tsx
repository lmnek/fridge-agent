/** The idle panel (beats A and H): Coldex at rest, with a quiet fridge summary. Owned by part 1. */
import type { BusEvent } from "./bus";

export function Idle(_: { events: BusEvent[] }) {
  return (
    <div className="idle">
      <p>Coldex</p>
    </div>
  );
}
