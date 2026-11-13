# Hlas Fridy

| Soubor | Co dělá |
|---|---|
| `service.py` | odchozí hovory přes Twilio, stav hovorů, záznamník, SMS a WhatsApp, simulace v demo režimu |
| `policy.py` | pojistky: allowlist čísel, limity za hodinu a den, tiché hodiny |
| `twiml.py` | TwiML s `<ConversationRelay>` (čeština: Deepgram + ElevenLabs) |
| `relay.py` | WebSocket `/voice/relay`: text od Twilia jde agentovi, jeho odpověď se streamuje zpět po tokenech |

Tok hovoru:

1. `VoiceService.call_user()` zkontroluje pojistky a založí hovor přes Twilio s TwiML.
2. Twilio zavolá, přečte uvítání a otevře WebSocket na `FRIDA_PUBLIC_BASE_URL/voice/relay`.
3. `RelaySession` předá každou větu uživatele agentovi (`AgentBrain.respond`, kanál `voice`, effort `low`) a jeho text posílá zpět jako tokeny, takže Frida začne mluvit dřív, než dopíše větu.
4. Když agent zavolá nástroj `zavesit`, relay pošle `{"type": "end"}`. Server navíc hovor ukončí po `FRIDA_CALL_MAX_SECONDS`.

V demo režimu (bez Twilia) se hovor jen „simuluje“: UI dostane zprávu `call` se stavem `simulated`, ukáže příchozí hovor a po přijetí se mluví v prohlížeči přes `/api/chat` s `channel: "voice"` a `call_session_id`.

## Kam zapojit speech-to-speech model

Pokud má místo převodu řeči na text běžet realtime model (řeč na řeč), přidej vedle `relay.py` nový WebSocket handler pro Twilio Media Streams (`<Connect><Stream>`, audio μ-law 8 kHz) a v `twiml.py` funkci, která vrátí `<Stream>` místo `<ConversationRelay>`. Nástroje agenta použij přes `frida/agent/tools.py` (`tool_definitions("voice", ...)` a `run_tool(...)`), ať realtime model umí totéž co Frida v chatu. Pojistky z `policy.py` a watchdog z `service.py` zůstávají beze změny.
