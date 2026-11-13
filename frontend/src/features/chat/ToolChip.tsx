import { motion } from "motion/react";
import { Check, LoaderCircle, X } from "lucide-react";
import type { ToolCallInfo } from "../../lib/types";
import { cx } from "../../lib/format";

/** Živý štítek nástroje, který Frida právě používá ("Hledám akce: máslo"). */
export function ToolChip({ tool }: { tool: ToolCallInfo }) {
  const running = tool.status === "running";
  const error = tool.status === "error";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className={cx(
        "inline-flex max-w-full items-start gap-2 rounded-2xl border px-3 py-1.5 text-[12.5px]",
        running && "border-aurora/35 bg-aurora/10 text-frost",
        tool.status === "done" && "border-glacier/25 bg-glacier/[0.07] text-frost",
        error && "border-tomato/35 bg-tomato/10 text-frost",
      )}
      title={tool.summary ?? undefined}
    >
      <span className="mt-[1px] shrink-0" aria-hidden>
        {running ? (
          <LoaderCircle className="size-3.5 animate-spin text-aurora" />
        ) : error ? (
          <X className="size-3.5 text-tomato" />
        ) : (
          <Check className="size-3.5 text-glacier" />
        )}
      </span>
      <span className="min-w-0">
        <span className={cx("block font-medium", running && "shimmer-text")}>{tool.title}</span>
        {tool.summary && !running && tool.summary !== tool.title && <span className="block text-[11.5px] leading-snug text-mist">{tool.summary}</span>}
      </span>
      <span className="sr-only">{running ? "probíhá" : error ? "selhalo" : "hotovo"}</span>
    </motion.div>
  );
}
