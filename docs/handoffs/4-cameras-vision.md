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

## If the cameras can't run live

Router settings may keep the hub off our network, and we'll know by 14:30. The demo has to work either way, and
the live code stays in place, chosen by config rather than removed. Only the **source of the frames** and the
**trigger** change. The vision call, the diff, the events and Coldex's line are the same code in every mode:

| Mode | Frames from | Triggered by |
|---|---|---|
| Live | the Reolink hub | the door closing (motion settles) |
| Replay | real Reolink frames captured whenever the cameras worked, even on another network | a "door closed" hotkey, pressed as the actor closes the fridge |
| Phone photos | before and after photos of the same fridge taken with a phone | the same hotkey |
| Speech only | none | the actor says what they took ("took the last milk and eggs"), and the complaint handling in part 3 updates the inventory |

So capture frames at the first chance, and take the phone photos now as a fallback for the fallback.

## Built (13. 11., Honza)

Decided: option 1, the bridge runs the vision call. `bridge/camera.py` talks to the hub, `bridge/vision.py`
runs the pipeline and `bridge/test_vision.py` tests it.

- `POST /api/vision/look` makes the bridge take hub snapshots. With `{"frames": [data URL]}` it uses the
  webcam frames instead, which is what the kitchen page's `L` key does without a hub.
- `POST /api/vision/replay?name=b` runs `bridge/replay/b/` through the same pipeline. This is the stage's "door
  closed" hotkey. The folder holds `before_0.jpg` and `after_0.jpg` (or a phone's `before.jpg` and
  `after.jpg`). If it also holds `result.json`, that result is reused, so the card looks the same every time.
- `POST /api/vision/keep?name=b` saves the newest real run as that replay folder. Run it after a good rehearsal.
- The `done` event carries `tell`, and the kitchen page passes it to its Realtime session.
- While the door is open, the newest lit frame is kept, because the fridge goes dark once it shuts.
- The vision model is `VISION_MODEL`, default `gpt-5.5`. It isn't run against OpenAI yet.

## Fake mode

The replay and phone-photo modes above, marked `HACK(demo)`.

## Risks

- How long the cameras take to wake.
- Wi-Fi through a closed fridge door.
- The cold drains batteries, so run the cameras on USB power.
- Lighting inside the fridge.
- The real fridge contents have to match the story: pecorino, butter and yogurt inside, and no guanciale or spaghetti.
