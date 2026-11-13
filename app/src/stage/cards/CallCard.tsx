import type { BusEvent } from "../bus";
import Placeholder from "./Placeholder";

export default function CallCard({ events }: { events: BusEvent[] }) {
  return <Placeholder id="F" events={events} />;
}
