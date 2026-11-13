import { useApp } from "../../store/app";
import { useAgentActivity } from "../../store/chat";
import { useVoice } from "../../store/voice";
import type { OrbState } from "./Orb";

/** Jeden zdroj pravdy pro to, co Frida právě dělá. */
export function useOrbState(): { state: OrbState; level: number } {
  const listening = useVoice((s) => s.listening);
  const speaking = useVoice((s) => s.speaking);
  const pulse = useVoice((s) => s.pulse);
  const activity = useAgentActivity();
  const ringing = useApp((s) => s.incomingCall !== null);

  if (ringing) return { state: "alert", level: 0.4 };
  if (listening) return { state: "listening", level: pulse };
  if (speaking) return { state: "speaking", level: pulse };
  if (activity === "thinking") return { state: "thinking", level: 0 };
  if (activity === "streaming") return { state: "speaking", level: 0.35 };
  return { state: "idle", level: 0 };
}

export const ORB_CAPTION: Record<OrbState, string> = {
  idle: "",
  listening: "Poslouchám",
  thinking: "Přemýšlím",
  speaking: "",
  alert: "Volám ti",
};
