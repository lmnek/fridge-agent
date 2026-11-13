import type { BusEvent } from "../bus";
import Placeholder from "./Placeholder";

export default function CartCard({ events }: { events: BusEvent[] }) {
  return <Placeholder id="C4" events={events} />;
}
