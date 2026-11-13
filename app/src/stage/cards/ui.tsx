// Shared building blocks for the side panel cards, so every card speaks the same visual language.
// Styles live in cards.css (classes prefixed `ck-`).
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, type ReactNode } from "react";
import type { BusEvent } from "../bus";
import "./cards.css";

/** The newest event of a type (optionally matching a predicate). */
export function latest(events: BusEvent[], type: string, pred?: (e: BusEvent) => boolean): BusEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === type && (!pred || pred(e))) return e;
  }
  return undefined;
}

/** Every event of a type, oldest first. */
export function all(events: BusEvent[], type: string, pred?: (e: BusEvent) => boolean): BusEvent[] {
  return events.filter((e) => e.type === type && (!pred || pred(e)));
}

/** Price in Czech crowns, the way Rohlík prints it: "812 Kč", "29,90 Kč". */
export function czk(n: number): string {
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  return `${n.toLocaleString("cs-CZ", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })} Kč`;
}

/** The card surface: kicker (small caps line), title, optional aside on the right, body, optional footer. */
export function CardFrame({
  kicker,
  title,
  aside,
  live,
  foot,
  children,
}: {
  kicker: string;
  title: ReactNode;
  aside?: ReactNode;
  live?: boolean;
  foot?: ReactNode;
  children?: ReactNode;
}) {
  return (
    // No entrance of its own: the stage panel (Panel.tsx) moves the whole card in and out, and the card's
    // content builds inside it (rows rise with `stagger`/`rise`), so the two never stack.
    <motion.section className="ck">
      <header className="ck-head">
        <div>
          <p className="ck-kicker">
            {live !== undefined && <span className={`ck-dot${live ? " is-live" : ""}`} />}
            {kicker}
          </p>
          <h2 className="ck-title">{title}</h2>
        </div>
        {aside && <div className="ck-aside">{aside}</div>}
      </header>
      <div className="ck-body">{children}</div>
      {foot && <footer className="ck-foot">{foot}</footer>}
    </motion.section>
  );
}

export type Tone = "lamp" | "soon" | "gone" | "ok" | undefined;

export function Tag({ tone, children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`ck-tag${tone ? ` ${tone}` : ""}`}>{children}</span>;
}

/** A step trail. `at` is the index of the running step; steps before it are done. */
export function Steps({ steps, at, done }: { steps: string[]; at: number; done?: boolean }) {
  return (
    <ol className="ck-steps">
      {steps.map((label, i) => (
        <li key={label} className={done || i < at ? "is-done" : i === at ? "is-active" : ""}>
          {label}
        </li>
      ))}
    </ol>
  );
}

/** A number that counts up to `to` once it mounts or changes. */
export function CountUp({ to, duration = 1.6, format = (n: number) => String(Math.round(n)) }: { to: number; duration?: number; format?: (n: number) => string }) {
  const value = useMotionValue(0);
  const text = useTransform(value, format);
  useEffect(() => {
    const controls = animate(value, to, { duration, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [to, duration, value]);
  return <motion.span className="ck-num">{text}</motion.span>;
}

/** Motion presets: rows that rise in one after another. Use `variants={rise}` on children of a `stagger` parent. */
export const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } } };
export const rise = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 320, damping: 30 } },
};
