import type { BusEvent } from "../bus";
import Placeholder from "./Placeholder";

export default function CheckoutCard({ events }: { events: BusEvent[] }) {
  return <Placeholder id="DE" events={events} />;
}
