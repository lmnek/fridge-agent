# 1. Stage view

Beats A–H. This is the screen on the projector, plus the kitchen page on the tablet.

## Goal

The audience watches one screen for three minutes. Coldex's orb is on the left and speaks, the side panel on
the right follows what the agent is doing, the kitchen stream is an inset, and subtitles carry every word.
It has to look clean and calm, and the orb is the one place to go all-out.

## Done when

- `app` has two modes: the **stage view** and the **kitchen page** (today's `App.tsx`, on the tablet at the fridge).
- **Stage layout:** the orb on the left, the side panel on the right, and the kitchen stream as an inset that's
  large in B and shrinks in C.
- **Subtitles** under the orb for everyone (Coldex, the actor, the presenter, the courier), from `caption`
  events. Both apps publish their own transcripts to the bus: Coldex's speech and the human's speech (part 3
  turns on input transcription in the session).
- **The panel switches cards** on `tool`, `vision`, `call` and `stage` events. The cards come from part 2, so
  use placeholders until they land.
- **The stage session's mic stays off until C** (a hotkey turns it on). Otherwise it answers the kitchen
  audio coming through the video call.
- **Hotkeys:** "door closed" (runs the B vision pipeline on captured frames when the cameras aren't live, part 4), type the C line instead of speaking it, cut to the B or C clip, force a
  beat (D/E, G, H, idle).
- **The kitchen page** wakes once and stays listening, and its voice plays through the fridge speaker.
- **The orb** is part 9 (the ice tesseract). Use its component as is, and pass it the status and the mic and voice levels (`levels()` in `realtime.ts`).

## Where

`app/src/stage/` (new), the mode switch in `app/src/main.tsx`, caption publishing and the mic gate in
`app/src/realtime.ts`, and the kitchen page in `app/src/App.tsx`. Part 4 also touches the camera handler in `App.tsx`.

## Decide early

**How the kitchen stream gets into the inset.** Embedding a browser video call is better (e.g. Jitsi or Whereby
in an iframe), because the page can resize and mute it, and so shrink it at C and cut its audio. A call
window laid over a reserved slot is the fallback. Check the free tier's limits on embedded calls.

## Parallelize

1. Layout, mode switch and the kitchen stream inset.
2. Subtitles: caption publishing from both apps, and rendering them.
3. Hotkeys and a dev event player, which replays a recorded list of bus events so part 2 can work without keys.

## Fake mode

The dev event player drives the whole stage view with no keys and no hardware. Record its event list from
the bus during a real run.

## Reuse

From the old Frida build: `frontend/src/components/orb/` and `frontend/src/features/call/CallLayer.tsx`.

## Risks

- **Echo:** the stage speakers feeding the stage mic, and the fridge speaker feeding the tablet mic. Rehearse with the real speakers.
- **Audio has one path at a time** (DEMO.md, Setup): the video call audio in B, Coldex from C on, the phone call in F.

## Update: fridge's-eye view, one kitchen session, the stage plays the audio

Decided 13. 11. ~13:45, and already written into DEMO.md (Setup, B, C, Fallbacks, Before the slot) and the
PLAN decision log. The new B: the inset shows a phone **inside the fridge, facing out**. The door opens, the
light comes on, the actor takes the last milk and eggs and says "Ugh, the last milk again. And I'm craving
carbonara tonight. Coldex, order what we need.", then closes the door. The view goes dark, the stage fades the
inset out, and the kitchen session's C narration plays on stage while the cards run. The presenter no longer
speaks to Coldex. In priority order:

1. **Kitchen audio relay.** The audience hears the kitchen only through the stage app, never through the video call.
   - **Kitchen page:** stream two channels to a bridge WebSocket: the tablet's mic, after the browser's echo
     cancellation, as `who: "kitchen"`, and Coldex's voice taken from the session's remote track before any
     speaker, as `who: "coldex"`. Coldex keeps playing on the tablet's output as today, which now goes to the
     actor's earbud.
   - **Bridge:** a new file such as `bridge/kitchen_audio.py`, mounted from `main.py` in a few lines: one socket
     in, and a fan-out socket out with the same message shape as `courier.py`'s `/listen` (`{"who", "audio"}`).
     Use 24 kHz PCM16, not mu-law, because this is the hero voice.
   - **Stage:** play it with `callAudio.ts`, extended with a format option rather than copied. Start it on the
     first click or key, and play it through A–C. The orb takes Coldex's level only, not the actor's, which
     replaces the synthetic kitchen level (`HACK(demo)`).
   - Keep it under about 0.5 s through the Cloudflare Tunnel. Verify with the kitchen page and the stage in two
     browsers, both opened through the tunnel URL.
   - **Never play the video call audio and the relay at the same time,** or Coldex is heard twice. The inset is
     always muted, and a hotkey unmutes it as the fallback when the relay dies.
2. **The inset fades out when the door closes.** It's large in A and B, then fades out (eased, about 1 s) on
   whichever comes first: the first `vision` event with `phase: captured`, the D hotkey, or the first C tool
   call. It doesn't come back, and the orb and panel take the space.
3. **One session for B and C, the kitchen's.**
   - The stage no longer starts its own session at C, and the stage mic never turns on. The stage session
     stays only as the T-hotkey fallback for typing the order, and M stays as an emergency key.
   - The door's vision events arrive a few seconds after C's narration has started. Show the B card until
     vision is done, then let C's tool calls take over. The panel must never jump back to B in the middle of C.
   - Part 2 owns the fixtures in `fixtures.ts`: the presenter's C caption goes, and the actor's caption now
     carries the order line. Tell part 2, or edit those two events yourself in one small commit.
4. **The fridge phone.**
   - It's a VDO.Ninja push with the audio off. Write the exact push URL in the `KitchenInset.tsx` comment and in
     DEMO.md Setup.
   - Find out what VDO.Ninja does when the shut fridge cuts the Wi-Fi, and how fast the picture comes back
     when the door opens. If recovery is slow, look for a URL parameter that helps, or note it under Risks for
     rehearsal.
5. **Rewrite Risks above.** Echo mostly goes away with the earbud and the stage mic off. The new risk is the
   shut fridge blocking the phone's Wi-Fi, and the cold draining its battery, so keep it plugged in.
