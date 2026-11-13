# 6. Courier call

Beat F. Coldex phones the real Rohlík courier, and the audience hears it.

## Goal

A hotkey (or a tool Coldex calls) starts a real phone call to the courier at the office entrance. Coldex
says, in Czech: "Hi, this is Kryštof's agent. You're delivering his Rohlík order. Skip the door and come
straight onto the stage." It handles a short answer and hangs up. The call plays through the stage speakers,
and the F card shows the caller ID, a timer and subtitles for both sides.

## Decide first (15 min)

1. **Reuse the old Frida voice relay** (`backend/frida/voice/`). It uses Twilio ConversationRelay: Twilio does
   the Czech speech-to-text and text-to-speech, and our server only handles text. It's built, with the number
   allowlist and limits. Add a `<Start><Stream>` fork so the call audio also reaches the stage. Least new code.
2. **Twilio Media Streams connected to OpenAI Realtime.** It has the same voice as Coldex, but it's new code (about 150 lines).

## Done when

- A hotkey on stage starts the call. Twilio calls the courier's number, which is on the allowlist.
- Coldex says the line, handles the reply in Czech, and hangs up.
- `call` and `caption` events (`who`: coldex, courier) reach the bus by `POST /api/events`.
- **The call audio plays on the stage speakers**, and it drives the orb. DEMO.md calls this the trickiest
  part of F, so verify it first.
- The courier is briefed (answer briefly, walk onto the stage after hanging up), and a backup cue is agreed:
  Honza texts them.

## Where

`bridge/courier.py` (new), or the old voice relay running alongside the bridge and publishing to its bus.
The call audio goes over its own WebSocket, and the stage view plays it (coordinate with part 1).

## Needs

A Twilio account with a number that can call Czech numbers, the Cloudflare tunnel's public URL, and the courier's number.

## Parallelize

1. The outbound call, TwiML and the Czech briefing prompt.
2. The audio fork to a WebSocket, and playback on stage (together with part 1).
3. The `call` events and both-sides captions.

## Fake mode

A recorded call (audio plus transcript) replayed through the same card. Honza texts the courier the cue.

## Risks

- Getting the audio to the stage.
- The Czech voice quality.
- Latency on the call.
- Twilio needs the tunnel to be up.
