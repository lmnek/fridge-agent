import type { BusEvent } from "../bus";
import Placeholder from "./Placeholder";

export default function ShopsCard({ events }: { events: BusEvent[] }) {
  return <Placeholder id="C3" events={events} />;
}
