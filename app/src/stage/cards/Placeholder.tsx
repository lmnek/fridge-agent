import type { BusEvent } from "../bus";

/** Stand-in until the real card lands. Shows the card id and how many events it has seen. */
export default function Placeholder({ id, events }: { id: string; events: BusEvent[] }) {
  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        height: "100%",
        border: "1px dashed #9fb3bd",
        borderRadius: 16,
        color: "#586a75",
        fontSize: 28,
      }}
    >
      {id} · {events.length} events
    </div>
  );
}
