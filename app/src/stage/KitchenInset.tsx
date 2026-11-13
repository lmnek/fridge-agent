/** The kitchen stream inset: large in A and B, small from C on, muted from C on. Owned by part 1, sub-task 1. */
export function KitchenInset({ size, muted }: { size: "large" | "small" | "hidden"; muted: boolean }) {
  return <div className="kitchen-inset" data-size={size} data-muted={muted} />;
}
