/**
 * Hlas v prohlížeči: rozpoznávání řeči (Web Speech API) a předčítání (speechSynthesis).
 * Obojí je volitelné, UI se bez nich obejde (psaní místo mluvení).
 */

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupport = {
  recognition: () => recognitionCtor() !== null,
  synthesis: () => typeof window !== "undefined" && "speechSynthesis" in window,
};

export interface Recognizer {
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export interface RecognizerHandlers {
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Prohlížeč nepovolil mikrofon. Povol ho v nastavení stránky.",
  "service-not-allowed": "Rozpoznávání řeči tu není povolené.",
  "no-speech": "Nic jsem neslyšela. Zkus to znovu.",
  "audio-capture": "Nenašla jsem mikrofon.",
  network: "Rozpoznávání řeči potřebuje internet.",
  aborted: "",
};

/** Jedno kolo poslechu: mluvíš, po pauze přijde výsledek a poslech skončí. */
export function createRecognizer(h: RecognizerHandlers, lang = "cs-CZ"): Recognizer | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let finalText = "";
  rec.onstart = () => h.onStart?.();
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    h.onInterim?.((finalText + interim).trim());
  };
  rec.onerror = (e) => {
    const msg = ERRORS[e.error] ?? `Rozpoznávání řeči selhalo (${e.error}).`;
    if (msg) h.onError?.(msg);
  };
  rec.onend = () => {
    const text = finalText.trim();
    finalText = "";
    if (text) h.onFinal(text);
    h.onEnd?.();
  };
  return {
    start: () => {
      try {
        rec.start();
      } catch {
        /* už běží */
      }
    },
    stop: () => rec.stop(),
    abort: () => rec.abort(),
  };
}

// ---------------------------------------------------------------- předčítání

let czechVoice: SpeechSynthesisVoice | null = null;
let voicesReady = false;

function pickVoice(): SpeechSynthesisVoice | null {
  if (!speechSupport.synthesis()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  voicesReady = true;
  const cs = voices.filter((v) => v.lang?.toLowerCase().replace("_", "-").startsWith("cs"));
  // přednost mají kvalitnější (online/premium) hlasy
  czechVoice =
    cs.find((v) => /natural|premium|enhanced|online/i.test(v.name)) ??
    cs.find((v) => /zuzana|iveta|vlasta/i.test(v.name)) ??
    cs[0] ??
    null;
  return czechVoice;
}

if (speechSupport.synthesis()) {
  pickVoice();
  window.speechSynthesis.addEventListener?.("voiceschanged", () => pickVoice());
}

export function hasCzechVoice(): boolean {
  if (!voicesReady) pickVoice();
  return czechVoice !== null;
}

/** iOS pustí řeč jen z gesta uživatele: tohle zavolej synchronně v obsluze kliknutí. */
export function unlockSpeech(): void {
  if (!speechSupport.synthesis()) return;
  try {
    const u = new SpeechSynthesisUtterance("");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    /* nic */
  }
}

export interface SpeakHandlers {
  onStart?: () => void;
  onEnd?: () => void;
  onBoundary?: () => void;
}

/** Odstraní z textu věci, které se špatně čtou nahlas (odkazy, markdown). */
export function speakable(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_#`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function speak(text: string, h: SpeakHandlers = {}): () => void {
  const clean = speakable(text);
  if (!speechSupport.synthesis() || !clean) {
    h.onEnd?.();
    return () => {};
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = "cs-CZ";
  const voice = czechVoice ?? pickVoice();
  if (voice) u.voice = voice;
  u.rate = 1.04;
  u.pitch = 1.05;
  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    window.clearTimeout(guard);
    h.onEnd?.();
  };
  // pojistka: některé prohlížeče onend nikdy nepošlou
  const guard = window.setTimeout(finish, Math.max(4000, clean.length * 110));
  u.onstart = () => h.onStart?.();
  u.onboundary = () => h.onBoundary?.();
  u.onend = finish;
  u.onerror = finish;
  synth.speak(u);
  return () => {
    synth.cancel();
    finish();
  };
}

export function stopSpeaking(): void {
  if (speechSupport.synthesis()) window.speechSynthesis.cancel();
}
