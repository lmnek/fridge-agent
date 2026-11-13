import type { BusEvent } from "../bus";
import Placeholder from "./Placeholder";

export default function FridgeCard({ events }: { events: BusEvent[] }) {
  return <Placeholder id="C1" events={events} />;
}
