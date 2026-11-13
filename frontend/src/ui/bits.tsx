import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { useId } from "react";
import { cx, splitEmoji } from "../lib/format";
import { chainStyle } from "../lib/chains";

/** Kruhový ukazatel (0..1). */
export function Ring({
  value,
  size = 44,
  stroke = 4,
  color = "var(--color-glacier)",
  track = "rgb(221 239 247 / 0.08)",
  children,
  className,
  label,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
  className?: string;
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div
      className={cx("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: "stroke-dashoffset .8s var(--ease-frost), stroke .4s" }}
        />
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center">{children}</div>}
    </div>
  );
}

export function FillBar({ value, color, className }: { value: number; color: string; className?: string }) {
  return (
    <div className={cx("h-1.5 overflow-hidden rounded-full bg-white/[0.07]", className)} aria-hidden>
      <div
        className="h-full rounded-full"
        style={{
          width: `${Math.round(Math.max(0.03, Math.min(1, value)) * 100)}%`,
          background: color,
          boxShadow: `0 0 12px ${color}`,
          transition: "width .7s var(--ease-frost)",
        }}
      />
    </div>
  );
}

/** Nenápadný štítek, že jde o simulovaná data. */
export function DemoTag({ className, children = "ukázková data" }: { className?: string; children?: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full border border-dashed border-mist/30 px-2 py-0.5 text-2xs text-mist",
        className,
      )}
      title="V demo režimu jsou data simulovaná"
    >
      {children}
    </span>
  );
}

export function ChainBadge({ chain, className }: { chain: string; className?: string }) {
  const s = chainStyle(chain);
  return (
    <span
      className={cx("inline-flex h-6 items-center rounded-md px-2 text-xs font-bold tracking-tight", className)}
      style={{ background: s.bg, color: s.fg }}
    >
      {chain}
    </span>
  );
}

export function SectionTitle({
  children,
  aside,
  className,
  id,
}: {
  children: ReactNode;
  aside?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div className={cx("mb-3 flex items-end justify-between gap-3", className)}>
      <h2 id={id} className="text-lg font-semibold text-frost">
        {children}
      </h2>
      {aside}
    </div>
  );
}

export function Panel({
  children,
  className,
  as: Tag = "section",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "aside";
} & Record<string, unknown>) {
  return (
    <Tag className={cx("glass rounded-[26px] p-4 sm:p-5", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function Pill({
  active,
  children,
  onClick,
  count,
  className,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  count?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-sm transition-colors",
        active ? "bg-frost text-ink" : "frost-chip text-mist hover:text-frost",
        className,
      )}
    >
      {children}
      {count !== undefined && (
        <span className={cx("tabular text-xs", active ? "text-ink/60" : "text-haze")}>{count}</span>
      )}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm text-frost">{label}</span>
        {hint && <span className="block text-xs text-mist">{hint}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative h-7 w-12 shrink-0 rounded-full transition-colors",
          checked ? "bg-glacier" : "bg-white/10",
        )}
      >
        <span
          className={cx(
            "absolute top-1 left-1 size-5 rounded-full bg-ink shadow transition-transform duration-200",
            checked ? "translate-x-5" : "bg-mist",
          )}
        />
      </button>
    </div>
  );
}

const inputCls =
  "h-11 w-full rounded-xl border border-white/10 bg-ink/60 px-3.5 text-frost placeholder:text-haze outline-none transition-colors focus:border-glacier/60 focus-visible:outline-none focus:ring-2 focus:ring-glacier/25";

export function Field({
  label,
  hint,
  className,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-xs text-mist">
        {label}
      </label>
      <input id={id} {...input} className={inputCls} />
      {hint && <p className="mt-1 text-xs text-haze">{hint}</p>}
    </div>
  );
}

export function SelectField({
  label,
  options,
  className,
  ...select
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; options: { value: string; label: string }[] }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-xs text-mist">
        {label}
      </label>
      <select id={id} {...select} className={cx(inputCls, "appearance-none pr-8")}>
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-abyss">
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export { inputCls };

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-2xl bg-white/[0.05]", className)} aria-hidden />;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="text-3xl text-mist">{icon}</div>}
      <p className="font-display text-lg text-frost">{title}</p>
      {children && <div className="max-w-sm text-sm text-mist">{children}</div>}
    </div>
  );
}

/** Titulek s emoji na začátku, emoji dostane vlastní mezeru. */
export function EmojiTitle({ text }: { text: string }) {
  const [emoji, rest] = splitEmoji(text);
  if (!emoji) return <>{text}</>;
  return (
    <>
      <span className="mr-1.5" aria-hidden>
        {emoji}
      </span>
      {rest}
    </>
  );
}
