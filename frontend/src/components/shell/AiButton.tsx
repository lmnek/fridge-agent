import { useRef, useState } from "react";
import { Mic } from "lucide-react";
import { Orb } from "../orb/Orb";
import { useOrbState } from "../orb/useOrbState";
import { useChat } from "../../store/chat";
import { useVoice } from "../../store/voice";
import { startVoiceTurn } from "../../features/chat/voiceTurn";
import { cx } from "../../lib/format";

const HOLD_MS = 420;

/** Frida dole uprostřed: klepnutí otevře chat, podržení spustí hlas. */
export function AiButton({ className }: { className?: string }) {
  const { state, level } = useOrbState();
  const open = useChat((s) => s.open);
  const setOpen = useChat((s) => s.setOpen);
  const listening = useVoice((s) => s.listening);
  const timer = useRef(0);
  const held = useRef(false);
  const [pressing, setPressing] = useState(false);

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    held.current = false;
    setPressing(true);
    timer.current = window.setTimeout(() => {
      held.current = true;
      navigator.vibrate?.(12);
      startVoiceTurn();
    }, HOLD_MS);
  };
  const onUp = () => {
    window.clearTimeout(timer.current);
    setPressing(false);
  };
  const onClick = () => {
    if (held.current) {
      held.current = false;
      return;
    }
    if (listening) {
      useVoice.getState().stopListening();
      return;
    }
    setOpen(!open);
  };

  return (
    <div className={cx("relative grid place-items-center", className)}>
      <Orb state={state} level={level} scale={0.3} className="pointer-events-none absolute size-[132px]" />
      <button
        type="button"
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        onPointerCancel={onUp}
        onClick={onClick}
        onContextMenu={(e) => e.preventDefault()}
        aria-label={listening ? "Zastavit poslech" : open ? "Zavřít chat s Fridou" : "Mluvit s Fridou. Podrž pro hlas."}
        aria-expanded={open}
        title="Klepni pro chat, podrž pro hlas"
        className={cx(
          "relative size-[78px] touch-none rounded-full transition-transform duration-200 select-none",
          pressing ? "scale-95" : "hover:scale-[1.04]",
        )}
      >
        {listening && (
          <span className="absolute -top-1 -right-1 grid size-6 place-items-center rounded-full bg-frost text-ink shadow-lg">
            <Mic className="size-3.5" aria-hidden />
          </span>
        )}
      </button>
    </div>
  );
}
