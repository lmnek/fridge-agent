import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Keyboard, Mic, MicOff, Phone, PhoneOff, SendHorizontal } from "lucide-react";
import { Orb } from "../../components/orb/Orb";
import { useOrbState } from "../../components/orb/useOrbState";
import { useApp } from "../../store/app";
import { useChat, type UIMessage } from "../../store/chat";
import { useVoice } from "../../store/voice";
import { api } from "../../lib/api";
import { speechSupport, unlockSpeech } from "../../lib/speech";
import { cx } from "../../lib/format";
import { MessageList } from "../chat/MessageList";
import type { CallSession } from "../../lib/types";

function greetingOf(session: CallSession): string {
  const line = [...session.transcript].reverse().find((l) => l.role === "assistant");
  return line?.text ?? `Ahoj, tady Frida. ${session.reason}`;
}

/** Příchozí hovor od Fridy přes celou obrazovku. */
function IncomingCall({ call }: { call: CallSession }) {
  const clearIncoming = useApp((s) => s.clearIncoming);
  const setActiveCall = useApp((s) => s.setActiveCall);
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState<"answer" | "decline" | null>(null);
  const accept = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    accept.current?.focus();
    navigator.vibrate?.([300, 200, 300, 200, 300]);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void decline();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const answer = async () => {
    unlockSpeech(); // musí být synchronně v gestu (iOS)
    setBusy("answer");
    try {
      const session = await api.answerCall(call.id);
      const greeting = greetingOf(session);
      const seed: UIMessage = {
        key: `greet_${session.id}`,
        id: `greet_${session.id}`,
        role: "assistant",
        text: greeting,
        tools: [],
        streaming: false,
        channel: "voice",
        ts: Date.now(),
      };
      useChat.getState().resetLane("call", [seed]);
      setActiveCall(session);
      clearIncoming();
    } catch (err) {
      toast({ title: "Hovor se nepodařilo přijmout", body: err instanceof Error ? err.message : undefined, tone: "critical" });
      clearIncoming();
    } finally {
      setBusy(null);
    }
  };

  const decline = async () => {
    setBusy("decline");
    try {
      await api.hangupCall(call.id);
    } catch {
      /* hovor už mohl skončit */
    }
    clearIncoming();
    setBusy(null);
  };

  return (
    <motion.div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="incoming-title"
      aria-describedby="incoming-reason"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] flex flex-col items-center justify-between bg-[#040b16]/95 px-6 pt-[calc(48px+var(--safe-t))] pb-[calc(48px+var(--safe-b))] backdrop-blur-xl"
    >
      <div className="text-center">
        <p className="text-sm text-mist">{call.status === "simulated" ? "Hovor v aplikaci" : "Příchozí hovor"}</p>
        <h2 id="incoming-title" className="display-tight mt-2 text-[44px] leading-none font-semibold text-frost sm:text-[64px]">
          Frida ti volá
        </h2>
      </div>
      <div className="relative grid size-[280px] place-items-center sm:size-[360px]">
        <Orb state="alert" level={0.5} scale={0.3} className="absolute inset-0 size-full" />
      </div>
      <div className="w-full max-w-md text-center">
        <p id="incoming-reason" className="font-display text-xl leading-snug font-light text-frost sm:text-2xl">
          {call.reason}
        </p>
        <div className="mt-10 flex items-center justify-center gap-16">
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => void decline()}
              disabled={busy !== null}
              className="grid size-[72px] place-items-center rounded-full bg-tomato text-white shadow-[0_10px_40px_-8px_rgb(255_111_97/0.7)] transition-transform active:scale-95 disabled:opacity-60"
              aria-label="Odmítnout hovor"
            >
              <PhoneOff className="size-7" aria-hidden />
            </button>
            <span className="text-sm text-mist">Odmítnout</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <span className="relative">
              <span className="absolute inset-0 animate-ring rounded-full bg-glacier/40" aria-hidden />
              <button
                ref={accept}
                type="button"
                onClick={() => void answer()}
                disabled={busy !== null}
                className="relative grid size-[72px] place-items-center rounded-full bg-glacier text-ink shadow-[0_10px_40px_-8px_rgb(110_240_216/0.8)] transition-transform active:scale-95 disabled:opacity-60"
                aria-label="Přijmout hovor"
              >
                <Phone className="size-7" aria-hidden />
              </button>
            </span>
            <span className="text-sm text-mist">Přijmout</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function useElapsed(since: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Probíhající hlasový hovor s Fridou v prohlížeči. */
function ActiveCall({ call }: { call: CallSession }) {
  const setActiveCall = useApp((s) => s.setActiveCall);
  const messages = useChat((s) => s.lanes.call.messages);
  const pending = useChat((s) => s.lanes.call.pending !== null);
  const listening = useVoice((s) => s.listening);
  const speaking = useVoice((s) => s.speaking);
  const interim = useVoice((s) => s.interim);
  const voiceError = useVoice((s) => s.error);
  const { state, level } = useOrbState();
  const canListen = speechSupport.recognition();
  const [typing, setTyping] = useState(!canListen);
  const [text, setText] = useState("");
  const [ended, setEnded] = useState(false);
  const endedRef = useRef(false);
  const startedAt = useRef(new Date().toISOString());
  const elapsed = useElapsed(startedAt.current);

  const finish = useCallback(
    async (opts: { remote?: boolean } = {}) => {
      if (endedRef.current) return;
      endedRef.current = true;
      setEnded(true);
      useVoice.getState().stopListening();
      if (!opts.remote) {
        useVoice.getState().hush();
        try {
          await api.hangupCall(call.id);
        } catch {
          /* už zavěšeno */
        }
      }
      window.setTimeout(() => setActiveCall(null), opts.remote ? 2600 : 900);
    },
    [call.id, setActiveCall],
  );

  const awaitingReply = useRef(false);
  const handleRef = useRef<(utterance: string) => void>(() => {});

  const listenNext = useCallback(() => {
    if (endedRef.current || !speechSupport.recognition()) return;
    useVoice.getState().listen((utterance) => handleRef.current(utterance));
  }, []);

  handleRef.current = (utterance: string) => {
    if (endedRef.current) return;
    awaitingReply.current = true;
    void useChat
      .getState()
      .send("call", utterance, { channel: "voice", callSessionId: call.id })
      .then((res) => {
        if (!res || endedRef.current) {
          awaitingReply.current = false;
          return;
        }
        // při hangup: true backend už zavěsil sám, jen dořekneme poslední větu
        useVoice.getState().say(res.message.text, () => {
          if (res.hangup) void finish({ remote: true });
          else listenNext();
        });
        awaitingReply.current = false;
      });
  };

  // na začátku Frida pozdraví a pak poslouchá
  useEffect(() => {
    const greeting = useChat.getState().lanes.call.messages.find((m) => m.role === "assistant")?.text;
    if (greeting) useVoice.getState().say(greeting, listenNext);
    else listenNext();
    return () => {
      useVoice.getState().stopListening();
      useVoice.getState().hush();
    };
  }, [listenNext]);

  // hovor ukončený ze serveru (watchdog, Twilio...)
  useEffect(() => {
    if (call.ended_at || call.status === "completed" || call.status === "failed") {
      if (!endedRef.current && !speaking && !pending && !awaitingReply.current) void finish({ remote: true });
    }
  }, [call.ended_at, call.status, speaking, pending, finish]);

  const sendTyped = () => {
    const t = text.trim();
    if (!t || pending || ended) return;
    setText("");
    useVoice.getState().stopListening();
    handleRef.current(t);
  };

  const status = ended
    ? "Hovor skončil"
    : listening
      ? interim || "Poslouchám…"
      : state === "thinking"
        ? "Frida přemýšlí…"
        : speaking
          ? "Frida mluví"
          : canListen
            ? "Klepni na mikrofon a mluv"
            : "Napiš, co chceš Fridě říct";

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Hovor s Fridou"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] flex flex-col bg-[#040b16]/[0.97] backdrop-blur-xl"
    >
      <header className="flex items-center justify-between px-6 pt-[calc(20px+var(--safe-t))]">
        <div>
          <p className="font-display text-xl font-semibold">Frida</p>
          <p className="tabular text-sm text-mist">{ended ? "Konec hovoru" : elapsed}</p>
        </div>
        <p className="max-w-[60%] truncate text-right text-xs text-mist" title={call.reason}>
          {call.reason}
        </p>
      </header>

      <div className="relative mx-auto grid h-[34dvh] min-h-[220px] w-full max-w-[420px] place-items-center">
        <Orb state={ended ? "idle" : state} level={level} scale={0.3} className="absolute inset-0 size-full" />
      </div>
      <p className={cx("px-6 text-center font-display text-lg font-light", listening ? "text-glacier" : "text-mist")} role="status">
        {status}
      </p>
      {voiceError && <p className="mt-1 px-6 text-center text-sm text-apricot">{voiceError}</p>}

      <div className="mx-auto mt-4 min-h-0 w-full max-w-2xl flex-1 overflow-y-auto px-6 pb-4">
        <MessageList messages={messages} />
      </div>

      <div className="mx-auto w-full max-w-2xl px-6 pb-[calc(28px+var(--safe-b))]">
        <AnimatePresence>
          {typing && !ended && (
            <motion.form
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="mb-5 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                sendTyped();
              }}
            >
              <label htmlFor="call-input" className="sr-only">
                Odpověď Fridě
              </label>
              <input
                id="call-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Napiš odpověď…"
                autoComplete="off"
                className="h-12 flex-1 rounded-full border border-white/10 bg-ink/70 px-5 text-frost outline-none placeholder:text-haze focus:border-glacier/50"
              />
              <button
                type="submit"
                disabled={!text.trim() || pending}
                aria-label="Odeslat odpověď"
                className="grid size-12 place-items-center rounded-full bg-glacier text-ink disabled:opacity-50"
              >
                <SendHorizontal className="size-5" aria-hidden />
              </button>
            </motion.form>
          )}
        </AnimatePresence>
        <div className="flex items-center justify-center gap-8">
          <button
            type="button"
            onClick={() => setTyping((v) => !v)}
            aria-pressed={typing}
            aria-label={typing ? "Skrýt psaní" : "Psát místo mluvení"}
            className={cx(
              "grid size-14 place-items-center rounded-full transition-colors",
              typing ? "bg-frost text-ink" : "frost-chip text-frost",
            )}
            disabled={ended}
          >
            <Keyboard className="size-6" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => void finish()}
            disabled={ended}
            aria-label="Zavěsit"
            className="grid size-[72px] place-items-center rounded-full bg-tomato text-white shadow-[0_10px_40px_-8px_rgb(255_111_97/0.7)] transition-transform active:scale-95 disabled:opacity-60"
          >
            <PhoneOff className="size-7" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => {
              if (listening) useVoice.getState().stopListening();
              else {
                useVoice.getState().hush();
                listenNext();
              }
            }}
            disabled={ended || !canListen || pending}
            aria-pressed={listening}
            aria-label={listening ? "Přestat poslouchat" : "Mluvit"}
            className={cx(
              "grid size-14 place-items-center rounded-full transition-colors disabled:opacity-40",
              listening ? "bg-glacier text-ink" : "frost-chip text-frost",
            )}
          >
            {canListen ? <Mic className="size-6" aria-hidden /> : <MicOff className="size-6" aria-hidden />}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export function CallLayer() {
  const incoming = useApp((s) => s.incomingCall);
  const active = useApp((s) => s.activeCall);
  return createPortal(
    <AnimatePresence>
      {active ? (
        <ActiveCall key={`active-${active.id}`} call={active} />
      ) : incoming ? (
        <IncomingCall key={`in-${incoming.id}`} call={incoming} />
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
