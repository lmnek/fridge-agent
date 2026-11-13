import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Mic } from "lucide-react";
import type { UIMessage } from "../../store/chat";
import { cx } from "../../lib/format";
import { RichText } from "./RichText";
import { ToolChip } from "./ToolChip";

function Thinking() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="Frida přemýšlí">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1.5 rounded-full bg-aurora"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </span>
  );
}

export function MessageBubble({ m }: { m: UIMessage }) {
  if (m.role === "user") {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
        <div className="max-w-[85%] rounded-[20px] rounded-br-md bg-frost/[0.09] px-4 py-2.5 text-[15px] text-frost">
          {m.channel === "voice" && <Mic className="mr-1.5 inline size-3.5 -translate-y-px text-mist" aria-label="řečeno hlasem" />}
          {m.text}
        </div>
      </motion.div>
    );
  }
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
      <span
        className="mt-1 size-6 shrink-0 rounded-full bg-[radial-gradient(circle_at_35%_30%,#e9fffb,#6ef0d8_35%,#5aa9ff_70%,#8c9bff)] shadow-[0_0_14px_rgb(110_240_216/0.45)]"
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        {m.tools.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {m.tools.map((t) => (
              <ToolChip key={t.id} tool={t} />
            ))}
          </div>
        )}
        <div className={cx("text-[15px] leading-relaxed text-frost/95", m.error && !m.text && "text-tomato")}>
          {m.text ? <RichText text={m.text} /> : m.streaming ? <Thinking /> : null}
          {m.streaming && m.text && (
            <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[3px] animate-pulse bg-glacier" aria-hidden />
          )}
        </div>
        {m.error && <p className="mt-1 text-xs text-tomato">Něco se pokazilo: {m.error}</p>}
      </div>
    </motion.div>
  );
}

export function MessageList({ messages, className }: { messages: UIMessage[]; className?: string }) {
  const end = useRef<HTMLDivElement>(null);
  const last = messages[messages.length - 1];
  useEffect(() => {
    // posunout jen vlastní scroll kontejner, ne celou stránku
    let el = end.current?.parentElement ?? null;
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, last?.text.length, last?.tools.length]);
  return (
    <div className={cx("space-y-5", className)} role="log" aria-live="polite" aria-relevant="additions">
      {messages.map((m) => (
        <MessageBubble key={m.key} m={m} />
      ))}
      <div ref={end} />
    </div>
  );
}
