// One line icon per card type, shown in the card header (CardFrame's `icon`). One set: a 24 grid, a 1.6 stroke,
// round caps and joins, no fills except tiny dots, drawn in currentColor (the frame tints them lamp blue).
import type { ReactNode } from "react";

export type IconId = "B" | "C1" | "C2" | "C3" | "C4" | "DE" | "F" | "G";

const DOT = { fill: "currentColor", stroke: "none" } as const;

const GLYPHS: Record<IconId, ReactNode> = {
  // B: the cameras see. A viewfinder around an eye.
  B: (
    <>
      <path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" />
      <path d="M6.5 12s2-3.6 5.5-3.6 5.5 3.6 5.5 3.6-2 3.6-5.5 3.6S6.5 12 6.5 12z" />
      <circle cx="12" cy="12" r="1.5" {...DOT} />
    </>
  ),
  // C1: inside the fridge. The fridge, freezer on top.
  C1: (
    <>
      <rect x="5" y="2.5" width="14" height="19" rx="2.5" />
      <path d="M5 9.5h14M8.5 5.4v1.6M8.5 12.4v3.6" />
    </>
  ),
  // C2: the recipe. A pot with steam.
  C2: (
    <>
      <path d="M3.5 10.5h17M5.5 10.5v6a3 3 0 0 0 3 3h7a3 3 0 0 0 3-3v-6M5.5 13H3.5M18.5 13h2" />
      <path d="M9.5 3.5c-.9 1 .9 2.2 0 3.4M14.5 3.5c-.9 1 .9 2.2 0 3.4" />
    </>
  ),
  // C3: where to buy. A radar with a sweep and a blip.
  C3: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.8" />
      <path d="M12 12l6.4-6.4" />
      <circle cx="15.3" cy="15" r="1.4" {...DOT} />
    </>
  ),
  // C4: the cart.
  C4: (
    <>
      <path d="M2.5 3.5h2.3l2.3 10.8a1.9 1.9 0 0 0 1.9 1.5h8.3a1.9 1.9 0 0 0 1.8-1.4L21 7.5H5.7" />
      <circle cx="9.6" cy="19.8" r="1.4" />
      <circle cx="16.8" cy="19.8" r="1.4" />
    </>
  ),
  // DE: checkout. A browser window with a check.
  DE: (
    <>
      <rect x="2.5" y="3.5" width="19" height="17" rx="2.5" />
      <path d="M2.5 8h19" />
      <path d="M8.6 14.2l2.4 2.4 4.6-4.8" />
    </>
  ),
  // F: the courier call. A handset with sound.
  F: (
    <>
      <path d="M8.2 3.6l1.6 3.7a1.3 1.3 0 0 1-.3 1.5l-1.6 1.4a11 11 0 0 0 5.9 5.9l1.4-1.6a1.3 1.3 0 0 1 1.5-.3l3.7 1.6a1.3 1.3 0 0 1 .7 1.5l-.6 2.3a1.6 1.6 0 0 1-1.6 1.2C10.6 20.6 3.4 13.4 3.2 5.1a1.6 1.6 0 0 1 1.2-1.6l2.3-.6a1.3 1.3 0 0 1 1.5.7z" />
      <path d="M14.5 3a6.5 6.5 0 0 1 6.5 6.5M14.5 6.4a3.1 3.1 0 0 1 3.1 3.1" />
    </>
  ),
  // G: delivered. A parcel at the door.
  G: (
    <>
      <path d="M12 2.8l8 4.2v10l-8 4.2-8-4.2V7z" />
      <path d="M4 7l8 4.2L20 7M12 11.2v10M8 4.9l8 4.2" />
    </>
  ),
};

export function CardIcon({ id, size = 40 }: { id: IconId; size?: number }) {
  return (
    <svg
      className="ck-icon-glyph"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {GLYPHS[id]}
    </svg>
  );
}
