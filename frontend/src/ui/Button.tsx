import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { cx } from "../lib/format";

type Variant = "primary" | "glass" | "ghost" | "warm" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-glacier text-ink hover:bg-[#8ff5e3] shadow-[0_0_0_1px_rgb(110_240_216/0.4),0_10px_30px_-10px_rgb(110_240_216/0.6)]",
  glass: "frost-chip text-frost hover:bg-white/10",
  ghost: "text-mist hover:text-frost hover:bg-white/5",
  warm: "bg-apricot text-ink hover:bg-[#ffc38f] shadow-[0_10px_30px_-12px_rgb(255_176_112/0.7)]",
  danger: "bg-tomato/15 text-tomato border border-tomato/30 hover:bg-tomato/25",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-full",
  md: "h-10 px-4 text-sm gap-2 rounded-full",
  lg: "h-12 px-5 text-[15px] gap-2 rounded-full",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  busy?: boolean;
}

export function Button({ variant = "glass", size = "md", icon, busy, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background,color,transform,opacity] duration-200 active:scale-[0.97] disabled:opacity-50",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    >
      {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  busy?: boolean;
}

const ICON_SIZE = { sm: "size-8", md: "size-10", lg: "size-12" };

export function IconButton({ label, variant = "ghost", size = "md", busy, className, children, disabled, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      disabled={disabled || busy}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full transition-[background,color,transform] duration-200 active:scale-95 disabled:opacity-50",
        VARIANT[variant],
        ICON_SIZE[size],
        className,
      )}
    >
      {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : children}
    </button>
  );
}
