import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Mic, RotateCcw, SendHorizontal, Square, Volume2, VolumeX, X } from "lucide-react";
import { useChat } from "../../store/chat";
import { useVoice } from "../../store/voice";
import { useApp } from "../../store/app";
import { speechSupport } from "../../lib/speech";
import { cx } from "../../lib/format";
import { IconButton } from "../../ui/Button";
import { DemoTag } from "../../ui/bits";
import { useOrbState } from "../../components/orb/useOrbState";
import { SUGGESTIONS } from "../home/brief";
import { MessageList } from "./MessageList";
import { askFrida, startVoiceTurn } from "./voiceTurn";

const STATUS: Record<string, string> = {
  idle: "Ptej se na cokoli o jídle a nákupech",
  listening: "Poslouchám…",
  thinking: "Přemýšlím…",
  speaking: "Odpovídám",
  alert: "Někdo volá",
};

export function ChatSheet() {
  const open = useChat((s) => s.open);
  const setOpen = useChat((s) => s.setOpen);
  const messages = useChat((s) => s.lanes.chat.messages);
  const pending = useChat((s) => s.lanes.chat.pending !== null);
  const resetLane = useChat((s) => s.resetLane);
  const listening = useVoice((s) => s.listening);
  const interim = useVoice((s) => s.interim);
  const voiceError = useVoice((s) => s.error);
  const readAloud = useVoice((s) => s.readAloud);
  const setReadAloud = useVoice((s) => s.setReadAloud);
  const agentMode = useApp((s) => s.agentMode);
  const { state } = useOrbState();
  const reduce = useReducedMotion();
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const canListen = speechSupport.recognition();

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => input.current?.focus({ preventScroll: true }), 120);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  const submit = () => {
    const t = text.trim();
    if (!t || pending) return;
    setText("");
    void askFrida(t);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="chat-backdrop"
            className="fixed inset-0 z-40 bg-[#030810]/55 backdrop-blur-[2px] lg:left-[92px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <motion.section
            key="chat-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Chat s Fridou"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 60, scale: 0.97 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 50, scale: 0.98 }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            style={{ transformOrigin: "50% 100%" }}
            className={cx(
              "glass fixed z-50 flex flex-col overflow-hidden bg-[#0a1829]/[0.94]",
              "inset-x-0 top-[max(5dvh,calc(var(--safe-t)+12px))] bottom-0 rounded-t-[28px]",
              "lg:inset-x-auto lg:top-auto lg:bottom-[128px] lg:left-[calc(50%+46px)] lg:h-[min(68dvh,680px)] lg:w-[min(720px,calc(100vw-160px))] lg:-translate-x-1/2 lg:rounded-[28px]",
            )}
          >
            <header className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-3.5">
              <span
                className={cx(
                  "size-2.5 rounded-full",
                  state === "listening" ? "bg-frost" : state === "thinking" ? "bg-aurora" : "bg-glacier",
                  state !== "idle" && "animate-pulse",
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="font-display text-lg leading-tight font-semibold">Frida</p>
                <p className="truncate text-xs text-mist">{STATUS[state]}</p>
              </div>
              {agentMode === "scripted" && <DemoTag className="max-sm:hidden">ukázkový mozek</DemoTag>}
              {messages.length > 0 && (
                <IconButton label="Nový rozhovor" size="sm" onClick={() => resetLane("chat")} disabled={pending}>
                  <RotateCcw className="size-4" />
                </IconButton>
              )}
              <IconButton
                label={readAloud ? "Nečíst odpovědi nahlas" : "Číst odpovědi nahlas"}
                size="sm"
                onClick={() => {
                  if (readAloud) useVoice.getState().hush();
                  setReadAloud(!readAloud);
                }}
                aria-pressed={readAloud}
              >
                {readAloud ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
              </IconButton>
              <IconButton label="Zavřít chat" size="sm" onClick={() => setOpen(false)}>
                <X className="size-4.5" />
              </IconButton>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {messages.length === 0 ? (
                <div className="flex h-full flex-col justify-end">
                  <p className="font-display text-[26px] leading-tight font-light text-frost">
                    Ahoj, tady Frida. Vím, co máš v lednici, co se kazí a kde je co v akci.
                  </p>
                  <p className="mt-2 text-sm text-mist">
                    Napiš mi, nebo podrž mikrofon a mluv.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void askFrida(s)}
                        className="frost-chip h-9 rounded-full px-4 text-sm text-frost transition-colors hover:border-glacier/40 hover:bg-glacier/10"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <MessageList messages={messages} />
              )}
            </div>

            {messages.length > 0 && !pending && (
              <div className="no-scrollbar flex gap-2 overflow-x-auto px-5 pb-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void askFrida(s)}
                    className="frost-chip h-8 shrink-0 rounded-full px-3 text-[13px] text-mist hover:text-frost"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div className="border-t border-white/[0.06] px-3 pt-3 pb-[calc(12px+var(--safe-b))] sm:px-4">
              {(listening || voiceError) && (
                <p className={cx("mb-2 px-2 text-sm", voiceError ? "text-apricot" : "text-glacier")} role="status">
                  {voiceError ?? (interim || "Poslouchám, mluv…")}
                </p>
              )}
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <label htmlFor="chat-input" className="sr-only">
                  Zpráva pro Fridu
                </label>
                <textarea
                  id="chat-input"
                  ref={input}
                  rows={1}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder="Zeptej se Fridy…"
                  className="max-h-[140px] min-h-12 flex-1 resize-none rounded-[22px] border border-white/10 bg-ink/60 px-4 py-3 text-[15px] text-frost outline-none placeholder:text-haze focus:border-glacier/50"
                />
                <IconButton
                  label={canListen ? (listening ? "Zastavit poslech" : "Mluvit") : "Hlas tu nejde, prohlížeč neumí rozpoznávat řeč"}
                  size="lg"
                  variant={listening ? "primary" : "glass"}
                  onClick={() => startVoiceTurn()}
                  aria-pressed={listening}
                  className={cx(!canListen && "opacity-50")}
                >
                  {listening ? <Square className="size-4 fill-current" /> : <Mic className="size-5" />}
                </IconButton>
                <IconButton label="Odeslat" size="lg" variant="primary" type="submit" disabled={!text.trim() || pending}>
                  <SendHorizontal className="size-5" />
                </IconButton>
              </form>
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}
