import { unlockSpeech } from "../../lib/speech";
import { useChat } from "../../store/chat";
import { useVoice } from "../../store/voice";

/** Jedno hlasové kolo v chatu: poslech, odeslání jako voice, přečtení odpovědi. */
export function startVoiceTurn(): void {
  unlockSpeech();
  useChat.getState().setOpen(true);
  const voice = useVoice.getState();
  if (voice.listening) {
    voice.stopListening();
    return;
  }
  voice.listen(async (text) => {
    const res = await useChat.getState().send("chat", text, { channel: "voice" });
    if (res && useVoice.getState().readAloud) useVoice.getState().say(res.message.text);
  });
}

/** Napsaný dotaz (nebo návrh). */
export async function askFrida(text: string): Promise<void> {
  useChat.getState().setOpen(true);
  await useChat.getState().send("chat", text, { channel: "text" });
}
