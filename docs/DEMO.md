# Coldex: demo script (3:00, hard stop)

This is the source of truth for the demo, and every build task should serve a beat here. The letters are stable
IDs, so use them in tasks and commits (e.g. "C4 cart card"). Everything is in English, including the courier call.

**Everything is live except D/E**, which shows the checkout as a stepped animation in the card. Every live beat
has a scripted or replayed fallback, and none of them needs a recording.

## Setup

- **Kitchen** (separate room): the fridge with a phone inside, facing out, and the backend laptop on our own travel
  router. The fridge phone streams over VDO.Ninja, and its camera and mic are Coldex's
  eye and ear. `/stage?kitchen=<room>` on the stage laptop is the brain (its own Realtime session for B and C),
  the screen and the speakers. Nobody opens `/` during the demo, or two sessions answer. The stage camera shows
  the fridge's-eye view, dark while the door is shut, then the light and the actor's face when it opens, from one
  of two sources:
  - **A Reolink camera with its mic:** run `infra/go2rtc.sh` on the backend laptop (go2rtc's standalone binary,
    `REOLINK_HOST`/`USER`/`PASSWORD` from `bridge/.env`, HTTP-FLV first, RTSP sub stream as fallback). The
    stage opens `/stage?kitchen=reolink` (or `reolink1` for the second camera) and plays it through the app's
    `/go2rtc` proxy in MSE mode, which carries the camera's AAC mic. `infra/go2rtc.sh --test` serves a test
    pattern and tone instead, without the hub.
  - **A phone inside the fridge, facing out,** over VDO.Ninja. The phone opens
    `https://vdo.ninja/?push=<room>&webcam&autostart&videodevice=back&quality=1&maxframerate=30&outboundvideobitrate=2500`
    (its mic is Coldex's ear; add `&audiodevice=0` for video only, and some Android phones need
    `videodevice=rear`), gets one tap so it holds its wake lock, and runs on a charger with auto-lock off. The
    stage opens `/stage?kitchen=<room>`.
- **Stage:** the presenter's laptop and the projector, running the **stage view** (below). The app is opened
  through the Cloudflare Tunnel URL, which Twilio also needs for the live call in F.
- **Audio: the stage app plays every sound, one path at a time.** At the start of A the presenter presses **M** on
  `/stage`, which wakes Coldex. **U turns the fridge camera and mic on and off together.** While the camera
  shows, Coldex hears the fridge phone's mic (VDO.Ninja SDK, `stage/phoneAudio.ts`) and the audience hears the
  actor. With the camera off, Coldex hears the stage laptop mic, which is the presenter. Coldex answers from the
  stage speakers. M again closes the input; the tab wakes itself after a reload, closing it ends the session.
  Without a VDO.Ninja room, the laptop mic is the input. In F the stage plays the phone call audio (see F below).
- **People:** the actor in the kitchen, the presenter on stage, and the **real Rohlík courier** waiting at the
  office entrance (we have a deal with Rohlík).

## Script

| | Time | Who, key | What happens | Side panel | Fallback |
|---|---|---|---|---|---|
| **A: Opener** | 0:00–0:10 | Presenter, **M** at the start | "This is Coldex, a fridge that runs its own kitchen. Our actor is at the fridge right now." | The big fridge camera shows. | |
| **B1: Check** | 0:10–0:25 | Actor, door open | Opens the door: "Coldex, anything I should use up tonight?" Coldex: "The Greek yogurt, it's due today." | **C1** fridge card. The camera shrinks to the pulsing picture-in-picture. | If the fridge stream or the stage session dies, Z plays the scripted run from here. |
| **B2: Kitchen** | 0:25–0:40 | Actor, door open | Takes the last milk and eggs: "And we're out of milk and eggs again. I'm craving carbonara tonight, so order what we need." Closes the door. | | No live cameras: a "door closed" hotkey (D) runs the same vision pipeline on saved frames, else drawn stand-ins with a saved result. Without frames, Coldex goes by what the actor said. |
| **C: Order** | 0:40–1:15 | Coldex | "Ordering three things. What just ran out: milk, lactose-free as always, and eggs, which carbonara needs anyway. For tonight: guanciale and spaghetti, with a gluten-free pack for Anna. And your weekly basics: yogurt, and bananas, which are on sale today. Lidl is 400 m away, but Rohlík delivers within the hour, so Rohlík. 685 Kč, ordering now." | **B vision** (frame captured, analysing, detection boxes, "milk: out, eggs: out", then the carbonara craving card). Then **C1** fridge check, with the missing items highlighted. **C2** carbonara broken into ingredients, each marked have or missing. **C3** where to buy: scraped prices and today's deals across Rohlík, Lidl and the nearby shops. **C4** the cart: rows with image, quantity and price, plus a why tag (*ran out*, *for carbonara*, *gluten-free · Anna*, *lactose-free*, *weekly*, *−20 % sale*). The total counts up. The approval prompt waits. | T types the order into the stage session, then X plays the scripted run from C, with the rendered narration if it's there. |
| **Nearby** | 1:15–1:30 | Presenter, **U** | Switches to the stage: "Before I approve: Coldex, what shops are nearby?" | The nearby map card. | |
| **Price** | 1:30–1:45 | Presenter | "And is the guanciale cheaper there?" Coldex explains why Rohlík. | The price card, with the real price and the cheapest shop. | Cut this if rehearsal runs over 2:50. |
| **D/E: Approval** | 1:45–2:00 | Presenter, **A** | "Good. It never orders without a human, so I approve." Coldex: "Approved. Order placed, courier on the way." **Staged**, nothing is ordered. | **The DE card** plays the real Rohlík checkout recording. | 4 forces the checkout card. |
| **F: Courier call** | 2:00–2:35 | Presenter, **K** if nothing happens | "That'll be the courier. Coldex, pick up." Coldex: "That's the courier calling, I'll pick up." On the call: "Hi, Coldex here, Kryštof's fridge… skip the door and come straight onto the stage." HACK(demo): Coldex actually dials out. The courier walks on stage. | **The F call card:** an incoming call, courier caller ID, a call timer, and **live subtitles for both sides**. | Shift K plays a fake call. Honza texts the courier the cue. If the audio fails, the subtitles carry it. |
| **G: Courier** | 2:35–2:45 | Presenter | Takes the bag. | The delivered card: a check mark. | The courier comes on Honza's cue anyway. |
| **H: Close** | 2:45–3:00 | Presenter | Holds up the phone: "It noticed, decided, ordered and called. We just opened the fridge." | The presenter's phone, mirrored: the Telegram chat that filled up during the demo (carbonara noted, cart ready, order placed). | The presenter holds up the phone and says the line. |

Notes:

- The actor says everything before closing the door, because the phone is inside the fridge and its mic and Wi-Fi fade when the door shuts. If the actor can't hear Coldex, they pause about 5 s after the first question.
- **U** is the presenter's only mic switch: the camera and the mic go together.
- The presenter's questions are live and use today's real prices, so they may differ from C3.
- The order stays pending until A.
- If rehearsal runs over 2:50, cut the guanciale question.

**Live subtitles for everything anyone says** (Coldex, the actor, the presenter, the courier) run under the orb
from A to H. If the audio fails, the text still carries the story.

## Stage view (`app/src/stage/`, see [handoffs](handoffs/README.md))

- Layout: the orb is the hero, big and dead centre with the subtitles under it, whenever nothing else shows
  (A, H). When a card or the fridge camera shows, the orb glides to the centre of the left half and stays big,
  and the card takes the right half. The big camera shows from A (the presenter presses M, and U
  toggles it). In B the B card rises and the camera shrinks to a picture-in-picture beside it, its border pulsing
  with the actor's voice. U hides it for good. Other camera placements:
  `/stage?layout=b` (a small picture-in-picture, the orb stays centred) and `layout=c` (the camera from A on).
- **The side panel follows the agent's tool calls, not a script.** Every tool call goes onto the bridge's event bus, so the panel switches cards based on which tool is running. It stays truthful and adds no latency.
- **The B card shows the vision pipeline live:** the captured frame, an "analysing" state, the detection boxes,
  then the diff ("milk: out, eggs: out").
- **The D/E card is a mini browser frame** with the checkout steps advancing on a timer. Decided 13. 11.: no
  recording, so nothing has to be captured before the slot.
- **Update 13. 11. ~16:00: the D/E card plays `app/public/demo/rohlik-checkout.mp4`** when the file exists (20 s, no
  audio). HACK(demo): it's the real rohlik.cz in English as a guest, but staged. A Playwright script pre-filled the 7
  demo items with no login, and on camera it adds the guanciale (×2), opens the cart drawer and the cart (688.14 CZK, 7 items),
  clicks "Continue to checkout", and stops on the address prompt. "Place your order" stays disabled, and nothing was ordered.
  The site total differs from the 685 Kč demo figure only because bananas are priced by weight.
- Reuse pieces from the old Frida build: the orb, the store radar, the cart panel, the tool-step chips, the call layer,
  and the camera view with detection boxes. Animate with `motion`, which is already installed. Design rules
  are in `CLAUDE.md`, with no emoji.
- **The H shot is Telegram on the presenter's phone, mirrored to the projector.** The bridge posts what Coldex
  does into the chat (craving noted, cart ready, order placed) during the demo, so it's real and already full
  by H.
- Hotkeys: replay the B frames (D), type the C line (T), play the scripted run from B or C (Z / X), wake Coldex
  / close the input (M), fridge camera + mic on / off together (U: on, Coldex hears the fridge and the camera stays as a pulsing picture-in-picture beside any card; off, it hides and the stage laptop mic is the input),
  approve the order (A), call the courier (K, Shift K for a fake call), force the checkout card (4). Press ? on the stage for all of them.
- Priority if time runs short: C4 cart, then the B analysis, then C3 map, then the D/E mini browser, then the F
  call card, then C1 and C2, then the H Telegram push.

## Must be real in the data

- **Household profile, seeded:** lactose-free milk, Anna is gluten-free, usual brands, and weekly basics (yogurt, bananas).
- **The complaint counts.** "Ugh, again" about the milk is taken as fact, and the milk goes in the next order.
- **The kitchen craving** is saved where every conversation sees it (the profile or timeline in the agent's
  context), not only in the kitchen conversation's history.
- **Every cart item carries a reason**, which feeds the why tags.
- **The sale is real** when the scraped deals have one (handoffs, part 8). Otherwise it's staged.
- **Speed:** C's agent turn takes about 25 s. Store each item's Rohlík product IDs ahead of time, batch the
  Rohlík searches (4 per call), and stream the narration while tools run.

## The live courier call (F)

- **The audience has to hear the call.** A Twilio call runs between Twilio's servers and the courier's phone,
  so nothing plays on our laptop by default. Twilio can copy a call's audio, both sides, to our backend (a media
  stream started before the call's voice-agent setup), and the stage view plays it, which also drives the orb.
  Phone-quality audio sounds authentic. **Verify early. It's the trickiest piece of F.**
- **Language:** English. Check that the courier is comfortable answering in English.
- **Brief the courier:** they'll get a call from an AI agent, should answer briefly, and come onto the stage
  after hanging up. Agree on a backup cue (a text from Honza).
- Twilio needs a public URL (the Cloudflare Tunnel), and the courier's number has to be on the call allowlist
  (`FRIDA_ALLOWED_CALL_NUMBERS`).

## Recordings

| What | When | Notes |
|---|---|---|
| **B frames** (replay fallback, optional) | At the first real camera test | Real snapshots of the fridge before and after taking out the milk and eggs: `POST /vision/keep?name=b` after a good run. Without them D replays the drawn stand-ins. |
| **C narration** (optional) | When the voice is picked | `cd bridge && uv run python try_voices.py --narration <voice>` writes `app/public/demo/c-narration.wav`, which X plays in sync. Without it X runs silent with subtitles. |
| **Backup video** (the whole demo) | 15:30–16:00 | One clean full run. |

## Fallbacks

| Beat | If it fails |
|---|---|
| B | No live cameras: D runs saved frames through the same pipeline (rehearsal frames, else the drawn stand-ins). No frames at all: Coldex goes by what the actor said. The stream or the stage session dies: Z plays the scripted run from B. The fridge phone's mic dies: the actor repeats the line at the stage laptop mic (press U to switch it). |
| C | The presenter types the order into the stage session (T), then X plays the scripted run from C. |
| F | Honza texts the courier the cue, and the subtitles carry the story. |
| The whole demo | The backup video. |

## Build (owners suggested, swap freely)

| | Kryštof | Honza |
|---|---|---|
| **By 12:00** | Seed the household profile. | Check that the hub returns snapshots, and capture the B frames. Get the Rohlík OAuth token. Get a Twilio account and number, and check that the courier is fine with a call in English. |
| **By 13:30** | The craving is saved where every conversation sees it. Coldex's voice in the browser sounds good (ElevenLabs). | Real camera → inventory works end to end. A real cart fills from the agent. The tunnel is up. |
| **13:30–15:30** | The C turn, fast and narrated, with reasons on each item. The stage view: the B analysis card, the C cards, subtitles, hotkeys, the mini browser, and the Telegram push for H. | The courier call: briefing prompt, allowlist, audio to the stage, both-sides transcript. Record the D/E checkout. Remove the emoji and sparkle icons from the UI. |
| **15:30–17:45** | Record the backup video. Rehearse at least 3 runs. Code freeze at 16:45. | The same. Also brief the courier and agree on a cue. |

## Before the slot

- [ ] The lines and the voice are in English, including the courier call.
- [ ] C's timing has been checked in rehearsal.
- [ ] The cameras are on USB power, and the B replay frames are loaded.
- [ ] M on `/stage` woke Coldex, the phone's audio plays on the stage speakers, and `/` is closed everywhere.
- [ ] The travel router is up, and the tunnel URL opens on the stage laptop.
- [ ] The fridge phone is plugged in and streaming from inside the fridge, and its picture comes back fast when the door opens after being shut.
- [ ] A test call reaches the courier, and the audio plays on stage.
- [ ] The courier is at the entrance and knows the backup cue.
- [ ] The backup video is on the stage laptop. Z, X and D work with no recordings (check them once on the stage).
- [ ] The presenter's phone has the Coldex Telegram chat open, and its screen mirrors to the projector.
