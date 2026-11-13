import type { BusEvent } from "../bus";
import Placeholder from "./Placeholder";

export default function DeliveredCard({ events }: { events: BusEvent[] }) {
  return <Placeholder id="G" events={events} />;
}
