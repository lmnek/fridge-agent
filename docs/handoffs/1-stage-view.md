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
