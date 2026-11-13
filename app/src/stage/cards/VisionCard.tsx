import type { BusEvent } from "../bus";
import Placeholder from "./Placeholder";

export default function VisionCard({ events }: { events: BusEvent[] }) {
  return <Placeholder id="B" events={events} />;
}
