# 4. Cameras and vision

Beat B. This part makes Coldex see what leaves the fridge.

## Goal

The fridge door closes, and the cameras take real snapshots. Vision finds what changed and the inventory updates.
The B card shows the frame, "analysing", the detection boxes and "milk: out, eggs: out". Then Coldex at the
fridge says "That was the last of the milk and the eggs."

## Decide first (15 min)

1. **Recommended: the bridge runs one vision call** that returns the items with their boxes, then tells the
   kitchen session the diff as text. It gives the boxes DEMO.md wants and structured data for the B card, and
   it behaves the same every time.
2. **Send the photos to the Realtime session.** This is built today (`camera.ts` plus the `look` handler), but it
   has no boxes, and image input on our Realtime model is unverified.

## Done when

- The hub returns real snapshots from both cameras.
- The door closing (motion settles) starts the pipeline, and so can a manual trigger.
- `vision` events follow the bus table (captured, analysing, done, with frames, boxes, removed and added).
- Taking out the milk and eggs comes out as exactly those two, and the inventory updates.
- The kitchen Coldex reacts with the line above (its wording is part 3).
- The B frames are captured in a rehearsal, and a replay trigger runs them through the same pipeline, so the
  card looks identical (that's the fallback hotkey in DEMO.md).

## Where

`bridge/vision.py` (new), the camera section of `bridge/main.py`, `app/src/camera.ts`, and the `look` handler in `app/src/App.tsx`.

## Parallelize

1. Hub snapshots, motion trigger and capturing the B frames. This one needs the hardware.
2. The vision call, the diff and the events, built on photos of the fridge taken with a phone.
3. The replay path.

## Reuse (old Frida build, `backend/frida/`)

`vision/claude.py` (the prompt and boxes), `camera/change.py` (diffing), `camera/reolink.py`, and the notes in
`docs/integrace/reolink-kamera.md`.

## Fake mode

The replayed B frames.

## Risks

- How long the cameras take to wake.
- Wi-Fi through a closed fridge door.
- The cold drains batteries, so run the cameras on USB power.
- Lighting inside the fridge.
- The real fridge contents have to match the story: pecorino, butter and yogurt inside, and no guanciale or spaghetti.
