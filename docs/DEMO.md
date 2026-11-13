# Coldex: demo script (3:00, hard stop)

This is the source of truth for the demo, and every build task should serve a beat here. The letters are stable
IDs, so use them in tasks and commits (e.g. "C4 cart card"). Everything is in English, including the courier call.

**Everything is live except D/E**, which shows the checkout as a stepped animation in the card. Every live beat
has a scripted or replayed fallback, and none of them needs a recording.

## Setup

- **Kitchen** (separate room): the fridge with 2 Reolink cameras inside watching the shelves, the hub, and the
  backend laptop on our own travel router. A tablet at the fridge runs Coldex, the one session for both B and C,
  and the actor hears it through an earbud from the tablet. The stage inset shows the fridge's-eye view, dark
  while the door is shut, then the light and the actor's face when it opens, from one of two sources:
  - **A Reolink camera with its mic:** run `infra/go2rtc.sh` on the backend laptop (go2rtc's standalone binary,
    `REOLINK_HOST`/`USER`/`PASSWORD` from `bridge/.env`, HTTP-FLV first, RTSP sub stream as fallback). The
    stage opens `/stage?kitchen=reolink` (or `reolink1` for the second camera) and plays it through the app's
    `/go2rtc` proxy in MSE mode, which carries the camera's AAC mic. `infra/go2rtc.sh --test` serves a test
    pattern and tone instead, without the hub.
  - **A phone inside the fridge, facing out,** over VDO.Ninja. The phone opens
    `https://vdo.ninja/?push=<room>&webcam&autostart&videodevice=back&quality=1&maxframerate=30&outboundvideobitrate=2500`
    (its mic goes along for U; add `&audiodevice=0` for video only, and some Android phones need
    `videodevice=rear`), gets one tap so it holds its wake lock, and runs on a charger with auto-lock off. The
    stage opens `/stage?kitchen=<room>`.
- **Stage:** the presenter's laptop and the projector, running the **stage view** (below). The app is opened
  through the Cloudflare Tunnel URL, which Twilio also needs for the live call in F.
- **Audio: the stage app plays every sound, one path at a time.** In B and C it plays the kitchen relay: the
  tablet sends its mic (the actor) and Coldex's voice straight to the bridge, and the stage plays them, starting
  from the first click or key on the stage. The inset stays muted. U switches the actor's voice between the
  relay's kitchen mic and the inset's own mic (the camera's or the phone's), never both, and Coldex always
  comes through the relay. In F the stage plays the phone call audio (see F below). The stage mic stays off.
- **People:** the actor in the kitchen, the presenter on stage, and the **real Rohlík courier** waiting at the
  office entrance (we have a deal with Rohlík).

## Script

| | Time | Live / Rec | What happens | Side panel | Fallback |
|---|---|---|---|---|---|
| **A: Opener** | 0:00–0:10 | Live | Presenter: "This is Coldex, an autonomous agent that runs your fridge: what's inside, what you eat, and what gets ordered. Let's watch it work." | Coldex idle, with a quiet fridge summary | |
| **B: Kitchen** | 0:10–0:40 | Live | The large inset shows the fridge's-eye view: dark, then the door opens and the light comes on. The actor looks in, takes the last milk and the eggs, and talks to the fridge: "Coldex, we're out of milk and eggs again and I'm craving carbonara, so order what we need." The actor closes the door, the view goes dark, and the stage fades the inset out for good. | **The camera analysis, step by step:** frame captured → analysing → detection boxes → "milk: out, eggs: out". Then a carbonara craving card drops in. | The cameras may not run live (router settings). Then a "door closed" hotkey, pressed as the actor closes the fridge, runs the same vision pipeline on saved frames: real Reolink frames kept from rehearsal, else part 2's drawn stand-ins with a saved result (no camera, no vision call). The panel looks identical. Without any frames, Coldex goes by what the actor said. If the fridge stream or the kitchen session dies, Z plays the scripted run on the stage from B. If the relay's kitchen mic dies, U puts the actor on the camera's (or phone's) mic. |
| **C: Order** | 0:40–1:20 | Live | Coldex answers the actor from the kitchen session, heard on the stage, while the B analysis finishes: "Ordering three things. What just ran out: milk, lactose-free as always, and eggs, which carbonara needs anyway. For tonight: guanciale and spaghetti, with a gluten-free pack for Anna. And your weekly basics: yogurt, and bananas, which are on sale today. Lidl is 400 m away, but Rohlík delivers within the hour, so Rohlík. 685 Kč, ordering now." | **C1** fridge check, with the missing items highlighted. **C2** carbonara broken into ingredients, each marked have or missing. **C3** where to buy: an overview of the scraped prices and today's deals for these items across Rohlík, Lidl and the nearby shops, with a radar sweep showing Lidl at 400 m against Rohlík within the hour. **C4** the cart: rows with image, quantity and price, plus a why tag (*ran out*, *for carbonara*, *gluten-free · Anna*, *lactose-free*, *weekly*, *−20 % sale*). The total counts up. | A hotkey lets the presenter type the order into the stage session, which runs C the same way. Then X plays the scripted run on the stage from C, with the rendered narration if it's there. |
| **D/E: Fast forward** | 1:20–1:35 | **Staged** | The clock speeds up. "Order placed." "Courier on the way." | **Rohlík mini browser:** the checkout steps (cart, delivery slot, payment, order placed) advancing in the card. Then "courier on the way". | |
| **F: Courier call** | 1:35–2:25 | Live | Coldex phones the **real Rohlík courier** at the office entrance, and the call plays through the stage speakers: "Hi, this is Kryštof's agent. You're delivering his Rohlík order. Skip the door and come straight onto the stage." | Call card: courier caller ID, a call timer, and **live subtitles for both sides** | Honza texts the courier the cue. If the audio fails, the subtitles carry it. |
| **G: Courier** | 2:25–2:45 | Live | The courier walks onto the stage with the bag. | Delivered: a check mark | The courier comes on Honza's cue anyway. |
| **H: Close** | 2:45–3:00 | Live | "It noticed, decided, ordered and called. We just opened the fridge." The presenter holds up their phone with the Coldex Telegram chat: "And you can do all of this from your pocket." | The presenter's phone, mirrored: the Telegram chat that filled up during the demo (carbonara noted, cart ready, order placed). Then Coldex idle again | The presenter holds up the phone and says the line |

**Live subtitles for everything anyone says** (Coldex, the actor, the presenter, the courier) run under the orb
from A to H. If the audio fails, the text still carries the story.

## Stage view (`app/src/stage/`, see [handoffs](handoffs/README.md))

- Layout: the orb is the hero, big and dead centre with the subtitles under it, whenever nothing else shows
  (A, H). When a card or the fridge camera shows, the orb glides to the centre of the left half and stays big,
  and the card takes the right half. The camera takes that slot from B on and fades out for good when the
  door closes, and the B card rises in its place. The presenter presses 2 at "Let's watch it work" to bring
  the camera up, and it also comes up by itself once the kitchen speaks. Other camera placements:
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
- Hotkeys: replay the B frames (D), type the C line (T), play the scripted run from B or C (Z / X), swap the
  actor between the relay's kitchen mic and the camera's mic (U). Press ? on the stage for all of them.
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
| B | No live cameras: D runs saved frames through the same pipeline (rehearsal frames, else the drawn stand-ins). No frames at all: Coldex goes by what the actor said. The stream or the kitchen session dies: Z plays the scripted run from B. The relay's kitchen mic dies: U puts the actor on the camera's (or phone's) mic. Coldex stays on the relay. |
| C | The presenter types the order into the stage session (T), then X plays the scripted run from C. |
| F | Honza texts the courier the cue, and the subtitles carry the story. |
| The whole demo | The backup video. |

## Build (owners suggested, swap freely)

| | Kryštof | Honza |
|---|---|---|
| **By 12:00** | Seed the household profile. | Check that the hub returns snapshots, and capture the B frames. Get the Rohlík OAuth token. Get a Twilio account and number, and check that the courier is fine with a call in English. |
| **By 13:30** | Get a small Bluetooth speaker for the fridge (borrow one at the venue, or buy one). The craving is saved where every conversation sees it. Coldex's voice in the browser sounds good (ElevenLabs). | Real camera → inventory works end to end. A real cart fills from the agent. The tunnel is up. |
| **13:30–15:30** | The C turn, fast and narrated, with reasons on each item. The stage view: the B analysis card, the C cards, subtitles, hotkeys, the mini browser, and the Telegram push for H. | The courier call: briefing prompt, allowlist, audio to the stage, both-sides transcript. Record the D/E checkout. Remove the emoji and sparkle icons from the UI. |
| **15:30–17:45** | Record the backup video. Rehearse at least 3 runs. Code freeze at 16:45. | The same. Also brief the courier and agree on a cue. |

## Before the slot

- [ ] The lines and the voice are in English, including the courier call.
- [ ] C's timing has been checked in rehearsal.
- [ ] The cameras are on USB power, and the B replay frames are loaded.
- [ ] The actor's earbud is charged and paired with the tablet, and the kitchen relay plays on the stage speakers.
- [ ] The travel router is up, and the tunnel URL opens on the stage laptop.
- [ ] The fridge phone is plugged in and streaming from inside the fridge, and its picture comes back fast when the door opens after being shut.
- [ ] A test call reaches the courier, and the audio plays on stage.
- [ ] The courier is at the entrance and knows the backup cue.
- [ ] The backup video is on the stage laptop. Z, X and D work with no recordings (check them once on the stage).
- [ ] The presenter's phone has the Coldex Telegram chat open, and its screen mirrors to the projector.
