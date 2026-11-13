import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Mic, Sparkles } from "lucide-react";
import { Orb } from "../../components/orb/Orb";
import { ORB_CAPTION, useOrbState } from "../../components/orb/useOrbState";
import { useApp } from "../../store/app";
import { useLastAssistantText } from "../../store/chat";
import { useVoice } from "../../store/voice";
import { useRoute } from "../../store/route";
import { api } from "../../lib/api";
import { czk, cx, num } from "../../lib/format";
import { askFrida, startVoiceTurn } from "../chat/voiceTurn";
import { composeBrief, SUGGESTIONS } from "./brief";

export interface Vital {
  key: string;
  value: string;
  label: string;
  tone?: "warm" | "alert" | "cool";
  onClick?: () => void;
}

function useVitals(): Vital[] {
  const s = useApp((st) => st.summary);
  const go = useRoute((st) => st.go);
  const [savings, setSavings] = useState<number | null>(null);
  useEffect(() => {
    api
      .analytics()
      .then((a) => setSavings(a.savings_month_czk))
      .catch(() => setSavings(null));
  }, []);
  if (!s) return [];
  const ending = s.expiring + s.expired;
  const running = s.low + s.out;
  return [
    { key: "items", value: num(s.total_items, 0), label: "věcí v lednici", onClick: () => go("lednice") },
    {
      key: "ending",
      value: num(ending, 0),
      label: ending === 1 ? "brzy končí" : "brzy končí",
      tone: s.expired ? "alert" : ending ? "warm" : undefined,
      onClick: () => go("lednice", "konci"),
    },
    {
      key: "running",
      value: num(running, 0),
      label: "dochází nebo došlo",
      tone: running ? "warm" : undefined,
      onClick: () => go("lednice", "dochazi"),
    },
    { key: "value", value: czk(s.value_czk, { whole: true }), label: "hodnota uvnitř", onClick: () => go("prehled") },
    {
      key: "waste",
      value: czk(s.waste_month_czk, { whole: true }),
      label: "vyhozeno tento měsíc",
      tone: s.waste_month_czk > 0 ? "alert" : "cool",
      onClick: () => go("prehled"),
    },
    {
      key: "savings",
      value: savings === null ? "–" : czk(savings, { whole: true }),
      label: "ušetřeno na akcích",
      tone: "cool",
      onClick: () => go("nakup"),
    },
  ];
}

const TONE_CLS = { warm: "text-apricot", alert: "text-tomato", cool: "text-glacier" } as const;

/** rozmístění satelitů kolem orbu (stupně) */
const ANGLES = [-148, 180, 148, -32, 0, 32];

function Satellite({ v, angle, rx, ry }: { v: Vital; angle: number; rx: number; ry: number }) {
  const a = (angle * Math.PI) / 180;
  const x = Math.cos(a) * rx;
  const y = Math.sin(a) * ry;
  const left = x < 0;
  return (
    <button
      type="button"
      onClick={v.onClick}
      className={cx(
        "group absolute top-1/2 left-1/2 w-[118px] rounded-xl p-1.5 text-left transition-colors hover:bg-white/[0.03]",
        left ? "items-end text-right" : "",
      )}
      style={{ transform: `translate(calc(${x}px - ${left ? 100 : 0}%), calc(${y}px - 50%))` }}
    >
      <span
        className={cx(
          "block text-[30px] leading-none font-semibold display-tight tabular transition-colors",
          v.tone ? TONE_CLS[v.tone] : "text-frost",
        )}
      >
        {v.value}
      </span>
      <span className="mt-1 block text-[12.5px] leading-tight text-mist group-hover:text-frost">{v.label}</span>
    </button>
  );
}

/** Oblouk čerstvosti kolem orbu, otevřený dole. */
function FreshnessArc({ score, size }: { score: number; size: number }) {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const sweep = 0.78; // část kruhu, kterou oblouk zabírá
  const v = Math.max(0, Math.min(100, score)) / 100;
  const color = score >= 70 ? "var(--color-glacier)" : score >= 45 ? "var(--color-butter)" : "var(--color-apricot)";
  const rotate = 90 + (360 * (1 - sweep)) / 2;
  return (
    <svg
      width={size}
      height={size}
      className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
      aria-hidden
    >
      <g transform={`rotate(${rotate} ${size / 2} ${size / 2})`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgb(221 239 247 / 0.07)"
          strokeWidth={3}
          strokeDasharray={`${c * sweep} ${c}`}
          strokeLinecap="round"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={`${c * sweep * v} ${c}`}
          style={{ transition: "stroke-dasharray 1s var(--ease-frost)", filter: `drop-shadow(0 0 6px ${color})` }}
        />
        {/* rysky po 10 % */}
        {Array.from({ length: 11 }, (_, i) => {
          const ang = (i / 10) * sweep * 2 * Math.PI;
          const x1 = size / 2 + Math.cos(ang) * (r + 7);
          const y1 = size / 2 + Math.sin(ang) * (r + 7);
          const x2 = size / 2 + Math.cos(ang) * (r + 11);
          const y2 = size / 2 + Math.sin(ang) * (r + 11);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgb(221 239 247 / 0.18)" strokeWidth={1} />;
        })}
      </g>
    </svg>
  );
}

export function OrbStage() {
  const { state, level } = useOrbState();
  const vitals = useVitals();
  const summary = useApp((s) => s.summary);
  const items = useApp((s) => s.items);
  const last = useLastAssistantText();
  const interim = useVoice((s) => s.interim);
  const listening = useVoice((s) => s.listening);
  const brief = composeBrief(items);
  const score = summary?.freshness_score ?? 0;

  const caption = listening
    ? interim || "Poslouchám…"
    : last && (last.streaming || last.text)
      ? last.text || ORB_CAPTION.thinking + "…"
      : brief.line;
  const live = listening || !!last?.streaming;

  return (
    <section aria-label="Frida" className="@container relative flex flex-col items-center">
      {/* orb + satelity */}
      <div className="relative h-[300px] w-full @min-[600px]:h-[460px]">
        <button
          type="button"
          onClick={() => startVoiceTurn()}
          className="absolute top-1/2 left-1/2 size-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full @min-[600px]:size-[440px]"
          aria-label="Klepni a mluv s Fridou"
        >
          <Orb state={state} level={level} scale={0.29} className="size-full" />
        </button>
        <div className="pointer-events-none absolute top-1/2 left-1/2 hidden -translate-x-1/2 -translate-y-1/2 @min-[600px]:block">
          <FreshnessArc score={score} size={330} />
        </div>
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 @min-[600px]:hidden">
          <FreshnessArc score={score} size={232} />
        </div>
        {/* skóre čerstvosti v mezeře oblouku */}
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-[96px] text-center @min-[600px]:translate-y-[142px]">
          <span className="display-tight tabular text-[26px] leading-none font-semibold text-frost">{score}</span>
          <span className="block text-[11px] text-mist">čerstvost</span>
        </div>
        <div className="hidden @min-[600px]:block">
          {vitals.map((v, i) => (
            <Satellite key={v.key} v={v} angle={ANGLES[i]} rx={i % 3 === 1 ? 200 : 192} ry={176} />
          ))}
        </div>
      </div>

      {/* Fridin titulek */}
      <div className="relative mt-1 w-full max-w-[640px] px-2 text-center" aria-live="polite">
        <AnimatePresence mode="wait">
          <motion.p
            key={live ? "live" : caption.slice(0, 24)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.35 }}
            className={cx(
              "font-display text-[21px] leading-[1.3] font-light text-frost sm:text-[26px]",
              "[font-variation-settings:'opsz'_48]",
              live && "text-glacier",
            )}
          >
            {caption}
            {last?.streaming && <span className="ml-0.5 inline-block h-[0.9em] w-[2px] translate-y-[2px] animate-pulse bg-glacier" />}
          </motion.p>
        </AnimatePresence>
      </div>

      {/* rychlé volby */}
      <div className="mt-5 flex w-full max-w-[720px] flex-wrap justify-center gap-2 px-2">
        <button
          type="button"
          onClick={() => void askFrida(brief.prompt)}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-glacier/12 px-4 text-sm text-glacier shadow-[inset_0_0_0_1px_rgb(110_240_216/0.3)] transition-colors hover:bg-glacier/20"
        >
          <Sparkles className="size-4" aria-hidden />
          {brief.promptLabel}
        </button>
        {SUGGESTIONS.slice(0, 4).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => void askFrida(s)}
            className="frost-chip hidden h-9 items-center rounded-full px-4 text-sm text-mist transition-colors hover:text-frost sm:inline-flex"
          >
            {s}
          </button>
        ))}
        <button
          type="button"
          onClick={() => startVoiceTurn()}
          className="frost-chip inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm text-mist hover:text-frost sm:hidden"
        >
          <Mic className="size-4" aria-hidden />
          Řekni mi to
        </button>
      </div>

      {/* vitální funkce na užší obrazovce */}
      <div className="mt-6 grid w-full grid-cols-3 gap-2 @min-[600px]:hidden">
        {vitals.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={v.onClick}
            className="frost-chip rounded-2xl px-3 py-3 text-left"
          >
            <span
              className={cx(
                "display-tight tabular block truncate text-[22px] leading-none font-semibold",
                v.tone ? TONE_CLS[v.tone] : "text-frost",
              )}
            >
              {v.value}
            </span>
            <span className="mt-1 block text-[11.5px] leading-tight text-mist">{v.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
