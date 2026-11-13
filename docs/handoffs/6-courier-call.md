# 6. Courier call

Beat F. Coldex phones the real Rohlík courier, and the audience hears it.

## Goal

A hotkey (or a tool Coldex calls) starts a real phone call to the courier at the office entrance. Coldex
says: "Hi, this is Kryštof's agent. You're delivering his Rohlík order. Skip the door and come
straight onto the stage." It handles a short answer and hangs up. The call plays through the stage speakers,
and the F card shows the caller ID, a timer and subtitles for both sides.

## Decide first (15 min)

1. **Reuse the old Frida voice relay** (`backend/frida/voice/`). It uses Twilio ConversationRelay: Twilio does the speech-to-text and text-to-speech, and our server only handles text. It's built, with the number
   allowlist and limits. Add a `<Start><Stream>` fork so the call audio also reaches the stage. Least new code.
2. **Twilio Media Streams connected to OpenAI Realtime.** It has the same voice as Coldex, but it's new code (about 150 lines).

## Done when

- A hotkey on stage starts the call. Twilio calls the courier's number, which is on the allowlist.
- Coldex says the line, handles the reply, and hangs up.
- `call` and `caption` events (`who`: coldex, courier) reach the bus by `POST /api/events`.
- **The call audio plays on the stage speakers**, and it drives the orb. DEMO.md calls this the trickiest
  part of F, so verify it first.
- The courier is briefed, in English (answer briefly, walk onto the stage after hanging up), and a backup cue is agreed:
  Honza texts them.

## Where

`bridge/courier.py` (new), or the old voice relay running alongside the bridge and publishing to its bus.
The call audio goes over its own WebSocket, and the stage view plays it (coordinate with part 1).

## Needs

A Twilio account with a number that can call Czech phone numbers, the Cloudflare tunnel's public URL, and the courier's number.

## Parallelize

1. The outbound call, TwiML and the briefing prompt.
2. The audio fork to a WebSocket, and playback on stage (together with part 1).
3. The `call` events and both-sides captions.

## Built (13. 11., Honza)

Decided: option 2, Twilio Media Streams connected to OpenAI Realtime. The bridge holds both sides of the call,
so the stage audio and the captions for both sides come from one place. Code: `bridge/courier.py`, the prompt
in `bridge/memory/courier.md`, tests in `bridge/test_courier.py`, stage playback in `app/src/stage/callAudio.ts`.

- `POST /api/courier/call` is the F hotkey. It calls `COURIER_NUMBER` and no other number.
- `POST /api/courier/hangup` ends the call. Coldex also hangs up by itself once its goodbye has played.
- `POST /api/courier/fake` plays a scripted call through the same `call` and `caption` events (HACK(demo)).
- `call` events: `phase` (dialing, ringing, answered, ended), `number` (masked). `caption` events: `who`
  (coldex, courier), `id`, `text` so far, `final`.
- For the stage, part 1 calls `playCallAudio()` from the hotkey handler and uses `level()` for the orb.
- If Coldex should start the call itself (the fixtures use a `call_courier` tool), that tool only needs to
  `POST /courier/call`.
- Setup: the Twilio and tunnel steps in `SETUP.md`. It hasn't run against Twilio yet.

## Fake mode

A recorded call (audio plus transcript) replayed through the same card. Honza texts the courier the cue.

## Risks

- Getting the audio to the stage.
- Whether the courier is comfortable answering in English. Check when you brief them.
- Latency on the call.
- Twilio needs the tunnel to be up.
