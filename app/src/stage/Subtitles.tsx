/** Live subtitles under the orb, for everyone who speaks (`caption` events). Owned by part 1, sub-task 2. */
import type { BusEvent } from "./bus";

export function Subtitles({ events }: { events: BusEvent[] }) {
  const last = events.filter((e) => e.type === "caption").at(-1);
  return <div className="subtitles">{last ? <p>{String(last.text ?? "")}</p> : null}</div>;
}
