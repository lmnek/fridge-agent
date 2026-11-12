# Hlas: Twilio ConversationRelay + Claude

Stav rešerše: 13. 11. 2026. Nic z toho neběží na AWS a nic není napojené na Daktelu.

## Jak to funguje

1. Frida zjistí, že něco došlo (nebo že expiruje maso), a rozhodne se zavolat.
2. Backend přes Twilio REST API vytvoří odchozí hovor (`calls.create`) s TwiML `<Connect><ConversationRelay …/></Connect>`.
3. Twilio zavolá na tvůj mobil. Řeč převádí na text (Deepgram) a text na řeč (ElevenLabs).
4. Přepsaný text chodí přes WebSocket na `wss://TVOJE_ADRESA/voice/relay`, kde odpovídá stejný agent jako v aplikaci (Claude), jen s kratšími odpověďmi a nižším `effort`.
5. Agent může během hovoru hledat akce, plnit košík v Rohlíku nebo hovor ukončit nástrojem `zavesit`.

ConversationRelay je GA od 14. 5. 2025. [changelog](https://www.twilio.com/en-us/changelog/conversationrelay-is-now-available-in-ga)

## Čeština

Podle [voice-configuration](https://www.twilio.com/docs/voice/conversationrelay/voice-configuration) je cs-CZ podporovaná:

- STT: **Deepgram `nova-3-general`** (výchozí pro cs-CZ)
- TTS: **ElevenLabs hlas `uYFJyGaibp4N2VwYQshk`** (výchozí pro cs-CZ), alternativa Google `cs-CZ-Wavenet-B`
- **Amazon Polly česky neumí**, a i kvůli zákazu AWS ho Frida nepoužívá.

Twilio výchozí hodnoty mění, proto je Frida nastavuje výslovně (`FRIDA_VOICE_*`). Před prvním použitím je potřeba v konzoli Twilio přijmout „Predictive and Generative AI/ML Features Addendum“ (Voice → Settings).

## Protokol WebSocketu (zkráceně)

| Směr | Zpráva | Pole |
|---|---|---|
| Twilio → Frida | `setup` | `sessionId`, `callSid`, `from`, `to`, `direction`, `customParameters` |
| | `prompt` | `voicePrompt`, `lang`, `last` |
| | `interrupt` | `utteranceUntilInterrupt`, `durationUntilInterruptMs` |
| | `dtmf` | `digit` |
| | `error` | `description` |
| Frida → Twilio | `text` | `token`, `last` |
| | `end` | `handoffData` (JSON jako text) |
| | `play`, `sendDigits`, `language` | |

[Popis zpráv](https://www.twilio.com/docs/voice/conversationrelay/websocket-messages). Twilio posílá při navázání WebSocketu hlavičku `X-Twilio-Signature`. Frida ji ověřuje přes `RequestValidator(auth_token).validate(wss_url, {}, podpis)`. Varianta s `wss://` a prázdnými parametry je převzatá z [článku v Node](https://dev.classmethod.jp/en/articles/twilio-conversationrelay-websocket-signature-verification/), v Pythonu neověřeno. Kdyby ověření padalo, dá se dočasně vypnout `FRIDA_VALIDATE_TWILIO_SIGNATURE=false`.

## Odchozí hovor

```python
client.calls.create(
    to="+420…", from_="+420…", twiml=twiml,
    status_callback="https://…/voice/status",
    status_callback_event=["initiated", "ringing", "answered", "completed"],
    machine_detection="Enable", async_amd=True,
    async_amd_status_callback="https://…/voice/amd",
)
```

- Asynchronní detekce záznamníku (`async_amd`) nezdrží pozdrav. Když to vezme záznamník, Frida zavěsí a pošle místo toho notifikaci.
- **Geo permissions:** v konzoli povol Česko (Voice → Settings → Geo permissions), jinak chyba 21215.
- **Číslo:** pro domácí hovory chce Twilio číslo od Twilia. Národní `+420910…` nepotřebuje dokumenty, mobilní `+42073…` vyžaduje doklad totožnosti. [CZ regulace](https://www.twilio.com/en-us/guidelines/cz/regulatory)
- **Trial účet** volá jen na ověřená čísla. Pro ConversationRelay a AMD je lepší účet upgradovat.

## Pojistky převzaté z AI Volavky

Z Volavky jsou převzaté jen bezpečnostní vzory, žádný kód ani infrastruktura:

- volat jde jen na čísla v `FRIDA_ALLOWED_CALL_NUMBERS`,
- hovor server sám ukončí po `FRIDA_CALL_MAX_SECONDS`,
- limity `FRIDA_CALLS_PER_HOUR` a `FRIDA_CALLS_PER_DAY`,
- agent má nástroj `zavesit`,
- klíče zůstávají na serveru, prohlížeč je nikdy nedostane.

Navíc proti Volavce: tiché hodiny (`FRIDA_QUIET_HOURS_START/END`), kdy se nevolá a jen se pošle tichá notifikace, a ověřování podpisu Twilia.

## SMS a WhatsApp

- **SMS v Česku:** mezinárodní čísla nedoručí do sítí T-Mobile a O2. Je potřeba předem registrované alfanumerické ID odesílatele, registrace trvá asi 3 týdny. [guideline](https://www.twilio.com/en-us/guidelines/cz/sms)
- **WhatsApp:** volný text jen do 24 hodin od tvé poslední zprávy. Upozornění, která začíná Frida, potřebují schválenou šablonu.

Proto je výchozí kanál notifikace v aplikaci a hovor. SMS a WhatsApp jsou připravené, ale vypnuté, dokud nenastavíš odesílatele.

## Hlas v prohlížeči

Tlačítko AI dole uprostřed používá Web Speech API (`SpeechRecognition`, `lang = "cs-CZ"`) a odpovědi čte `speechSynthesis` českým hlasem systému. Funguje v Chrome a Safari. Ve Firefoxu je rozpoznávání vypnuté, tam zůstane psaní. Žádný klíč do prohlížeče nejde.

## Alternativa: speech-to-speech jako u Volavky

Volavka používá realtime model (řeč na řeč). Pro telefon by to bylo Twilio Media Streams (`<Connect><Stream>`, μ-law 8 kHz) přemostěné na OpenAI Realtime (`gpt-realtime-2.1`, formát `audio/pcmu`, při `speech_started` poslat Twiliu `clear`). Oficiální vzor: [twilio-samples/speech-assistant-openai-realtime-api-python](https://github.com/twilio-samples/speech-assistant-openai-realtime-api-python). Model `gpt-realtime` končí 20. 1. 2027.

Frida tuhle cestu záměrně nepoužívá, protože mozkem je Claude a ConversationRelay dává stejný výsledek s jedním modelem a jedním promptem. Místo pro případné doplnění je popsané v `backend/frida/voice/README.md`.

## Alternativa: ElevenLabs Agents

ElevenLabs umí Twilio nativně (import čísla), odchozí hovor přes `POST https://api.elevenlabs.io/v1/convai/twilio/outbound-call` a jako LLM lze zvolit Claude. Čeština je v modelech Multilingual v2 a Flash v2.5. Hodí se, pokud bys chtěl hlasovou část úplně outsourcovat.

## Co nastavit

```bash
FRIDA_PUBLIC_BASE_URL=https://lednice.tvoje-domena.cz   # veřejná adresa (Cloudflare Tunnel)
FRIDA_TWILIO_ACCOUNT_SID=AC...
FRIDA_TWILIO_AUTH_TOKEN=...
FRIDA_TWILIO_FROM_NUMBER=+420910...
FRIDA_USER_PHONE=+420777...
FRIDA_ALLOWED_CALL_NUMBERS='["+420777..."]'
```

## Test samostatně

```bash
cd backend
uv run frida test-call --reason "Zkušební hovor"      # zavolá na FRIDA_USER_PHONE (jen z allowlistu)
uv run frida relay-sim                                # simulace hovoru v terminálu bez Twilia
```

## Neověřeno

- Google STT pro cs-CZ v ConversationRelay a české hlasy Google Chirp3-HD.
- `RequestValidator` v Pythonu s adresou `wss://`.
- Jestli projde ověřené české číslo jako caller ID pro domácí hovory.
- Přesnost detekce záznamníku na českých hlasových schránkách.
