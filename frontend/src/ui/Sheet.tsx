import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { cx } from "../lib/format";
import { IconButton } from "./Button";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** šířka na desktopu */
  size?: "sm" | "md" | "lg";
  className?: string;
}

const WIDTH = { sm: "sm:max-w-md", md: "sm:max-w-xl", lg: "sm:max-w-3xl" };

/** Na telefonu vyjede zespodu, na větší obrazovce je to dialog uprostřed. */
export function Sheet({ open, onClose, title, subtitle, children, footer, size = "md", className }: SheetProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && panel.current) {
        const nodes = panel.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => {
      const target = panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panel.current;
      target?.focus();
    }, 30);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-[#030810]/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={reduce ? { opacity: 0 } : { y: 40, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { y: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { y: 30, opacity: 0 }}
            transition={{ type: "spring", damping: 30, stiffness: 320 }}
            className={cx(
              "glass relative flex max-h-[92dvh] w-full flex-col rounded-t-[28px] outline-none sm:rounded-[28px]",
              "bg-[#0b1a2d]/95",
              WIDTH[size],
              className,
            )}
          >
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/15 sm:hidden" aria-hidden />
            <header className="flex items-start gap-3 px-5 pt-4 pb-3 sm:px-6 sm:pt-5">
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="text-xl font-semibold text-frost">
                  {title}
                </h2>
                {subtitle && <p className="mt-0.5 text-sm text-mist">{subtitle}</p>}
              </div>
              <IconButton label="Zavřít" onClick={onClose} className="-mr-2 -mt-1">
                <X className="size-5" />
              </IconButton>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6">{children}</div>
            {footer && (
              <footer className="border-t border-white/5 px-5 py-4 pb-[calc(1rem+var(--safe-b))] sm:px-6">{footer}</footer>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
