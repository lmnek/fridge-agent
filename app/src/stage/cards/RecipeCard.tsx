import type { BusEvent } from "../bus";
import Placeholder from "./Placeholder";

export default function RecipeCard({ events }: { events: BusEvent[] }) {
  return <Placeholder id="C2" events={events} />;
}
