import { create } from "zustand";
import { createRecognizer, speak as tts, speechSupport, stopSpeaking, type Recognizer } from "../lib/speech";

interface VoiceState {
  listening: boolean;
  speaking: boolean;
  interim: string;
  error: string | null;
  /** 0..1, krátké pulzy při řeči (orb na ně reaguje) */
  pulse: number;
  /** předčítat odpovědi v chatu nahlas */
  readAloud: boolean;
  listen: (onFinal: (text: string) => void) => boolean;
  stopListening: () => void;
  say: (text: string, onEnd?: () => void) => void;
  hush: () => void;
  setReadAloud: (v: boolean) => void;
  clearError: () => void;
}

let recognizer: Recognizer | null = null;
let cancelSpeech: (() => void) | null = null;
let speechToken = 0;
let pulseTimer = 0;

export const useVoice = create<VoiceState>((set, get) => {
  const bump = () => {
    set({ pulse: 1 });
    window.clearTimeout(pulseTimer);
    pulseTimer = window.setTimeout(() => set({ pulse: 0 }), 160);
  };

  return {
    listening: false,
    speaking: false,
    interim: "",
    error: null,
    pulse: 0,
    readAloud: true,

    listen: (onFinal) => {
      if (!speechSupport.recognition()) {
        set({ error: "Tenhle prohlížeč neumí rozpoznávat řeč. Napiš mi to, nebo zkus Chrome či Safari." });
        return false;
      }
      get().hush();
      recognizer?.abort();
      recognizer = createRecognizer({
        onStart: () => set({ listening: true, interim: "", error: null }),
        onInterim: (t) => {
          set({ interim: t });
          bump();
        },
        onFinal: (t) => {
          set({ interim: "" });
          onFinal(t);
        },
        onEnd: () => set({ listening: false }),
        onError: (msg) => set({ error: msg, listening: false }),
      });
      if (!recognizer) return false;
      set({ listening: true, interim: "", error: null });
      recognizer.start();
      return true;
    },
    stopListening: () => {
      recognizer?.stop();
      set({ listening: false });
    },
    say: (text, onEnd) => {
      get().hush();
      const token = ++speechToken;
      set({ speaking: true });
      cancelSpeech = tts(text, {
        onBoundary: bump,
        onEnd: () => {
          // přerušená řeč (hush) už nikoho nevolá
          if (token !== speechToken) return;
          cancelSpeech = null;
          set({ speaking: false, pulse: 0 });
          onEnd?.();
        },
      });
    },
    hush: () => {
      speechToken++;
      cancelSpeech?.();
      cancelSpeech = null;
      stopSpeaking();
      set({ speaking: false });
    },
    setReadAloud: (readAloud) => set({ readAloud }),
    clearError: () => set({ error: null }),
  };
});
