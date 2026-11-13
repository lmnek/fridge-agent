# Coldex: demo script (3:00, hard stop)

This is the source of truth for the demo, and every build task should serve a beat here. The letters are stable
IDs, so use them in tasks and commits (e.g. "C4 cart card"). Lines are written in English. The language is still
open (PLAN §8), so translate them if we go Czech. The courier call (F) is probably in Czech either way.

**Everything is live except D/E**, which plays a recording of the real Rohlík checkout. Every live beat has a
recorded or replayed fallback.

## Setup

- **Kitchen** (separate room): the fridge with 2 Reolink cameras inside, the hub, and the backend laptop on our
  own travel router. A tablet or phone at the fridge runs Coldex voice. A second phone on a tripod streams the
  kitchen to the stage over a video call.
- **Stage:** the presenter's laptop and the projector, running the **stage view** (below). The app is opened
  through the Cloudflare Tunnel URL, which Twilio also needs for the live call in F.
- **Audio:** one path at a time. During B the stage plays the video call audio, with the stage mic muted on
  the call. From C on, the video call audio is muted and Coldex plays through the stage speakers. In F the
  stage plays the phone call audio (see F below).
- **People:** the actor in the kitchen, the presenter on stage, and the **real Rohlík courier** waiting at the
  office entrance (we have a deal with Rohlík).

## Script

| | Time | Live / Rec | What happens | Side panel | Fallback |
|---|---|---|---|---|---|
| **A: Opener** | 0:00–0:10 | Live | Presenter: "This is Coldex, an autonomous agent that runs your fridge: what's inside, what you eat, and what gets ordered. Let's watch it work." | Coldex idle, with a quiet fridge summary | |
| **B: Kitchen** | 0:10–0:40 | Live | The stream (large inset) shows the actor opening the fridge and taking out the milk and eggs. The actor: "I'm craving carbonara tonight." Coldex: "Noted, carbonara." | **The camera analysis, step by step:** frame captured → analysing → detection boxes → "milk: out, eggs: out". Then a carbonara craving card drops in. | A hotkey replays real frames captured in rehearsal through the same pipeline, so the panel looks identical. The B clip covers a dead stream. |
| **C: Order** | 0:40–1:20 | Live | Presenter: "Let's order now, please." The stream shrinks to a corner. Coldex: "Ordering three things. What just ran out: milk, lactose-free as always, and eggs, which carbonara needs anyway. For tonight: guanciale and spaghetti, with a gluten-free pack for Anna. And your weekly basics: yogurt, and bananas, which are on sale today. Lidl is 400 m away, but Rohlík delivers within the hour, so Rohlík. 812 Kč, ordering now." | **C1** fridge check, with the missing items highlighted. **C2** carbonara broken into ingredients, each marked have or missing. **C3** a map with a radar sweep, Lidl at 400 m against Rohlík within the hour. **C4** the cart: rows with image, quantity and price, plus a why tag (*ran out*, *for carbonara*, *gluten-free · Anna*, *lactose-free*, *weekly*, *−20 % sale*). The total counts up toward the 749 Kč bar. | A hotkey lets the presenter type the line. Then the C clip. |
| **D/E: Fast forward** | 1:20–1:35 | **Rec** | The clock speeds up. "Order placed." "Courier on the way." | **Rohlík mini browser:** a sped-up screen recording of the real order being placed on rohlik.cz. Then "courier on the way". | |
| **F: Courier call** | 1:35–2:25 | Live | Coldex phones the **real Rohlík courier** at the office entrance, and the call plays through the stage speakers: "Hi, this is Kryštof's agent. You're delivering his Rohlík order. Skip the door and come straight onto the stage." | Call card: courier caller ID, a call timer, and **live subtitles for both sides** | Honza texts the courier the cue. If the audio fails, the subtitles carry it. |
| **G: Courier** | 2:25–2:45 | Live | The courier walks onto the stage with the bag. | Delivered: a check mark | The courier comes on Honza's cue anyway. |
| **H: Close** | 2:45–3:00 | Live | "It noticed, decided, ordered and called. We just opened the fridge." | Coldex idle again | |

**Live subtitles for everything anyone says** (Coldex, the actor, the presenter, the courier) run under the orb
from A to H. If the audio fails, the text still carries the story.

## Stage view (frontend, `frontend/src/features/stage/`)

- Layout: the speaking orb on the left, the side panel on the right, and the kitchen stream as an inset that's
  large in B and small afterwards.
- **The side panel follows the agent's tool calls, not a script.** The backend already streams tool calls to the
  UI, so the panel switches cards based on which tool is running. It stays truthful and adds no latency.
- **The B card shows the vision pipeline live:** the captured frame, an "analysing" state, the detection boxes,
  then the diff ("milk: out, eggs: out").
- **The D/E card is a mini browser frame** playing the recording of the real Rohlík checkout, sped up. It's a
  recording, not a simulated Rohlík page, because it's honest and costs nothing to build.
- Reuse Frida's existing pieces: the orb, the store radar, the cart panel, the tool-step chips, the call layer,
  and the camera view with detection boxes. Animate with `motion`, which is already installed. Design rules
  are in `CLAUDE.md`, with no emoji.
- Hotkeys: replay the B frames, type the C line, cut to the B or C clip.
- Priority if time runs short: C4 cart, then the B analysis, then C3 map, then the D/E mini browser, then the F
  call card, then C1 and C2.

## Must be real in the data

- **Household profile, seeded:** lactose-free milk, Anna is gluten-free, usual brands, and weekly basics (yogurt, bananas).
- **The kitchen craving** is saved where every conversation sees it (the profile or timeline in the agent's
  context), not only in the kitchen conversation's history.
- **Every cart item carries a reason**, which feeds the why tags.
- **The cart clears 749 Kč**, the Rohlík minimum order.
- **Speed:** C's agent turn takes about 25 s. Store each item's Rohlík product IDs ahead of time, batch the
  Rohlík searches (4 per call), and stream the narration while tools run.

## The live courier call (F)

- **The audience has to hear the call.** A Twilio call runs between Twilio's servers and the courier's phone,
  so nothing plays on our laptop by default. Twilio can copy a call's audio, both sides, to our backend (a media
  stream started before the call's voice-agent setup), and the stage view plays it, which also drives the orb.
  Phone-quality audio sounds authentic. **Verify early. It's the trickiest piece of F.**
- **Language:** the courier will probably answer in Czech, so the call is probably in Czech with English
  subtitles. Ask Rohlík or the courier.
- **Brief the courier:** they'll get a call from an AI agent, should answer briefly, and come onto the stage
  after hanging up. Agree on a backup cue (a text from Honza).
- Twilio needs a public URL (the Cloudflare Tunnel), and the courier's number has to be on the call allowlist
  (`FRIDA_ALLOWED_CALL_NUMBERS`).

## Recordings

| What | When | Notes |
|---|---|---|
| **D/E checkout** (plays in the demo) | When the real cart works | Screen-record the real Rohlík order on the phone or laptop. Coordinate the delivery with the Rohlík deal. |
| **B frames** (replay fallback) | At the first real camera test | Real snapshots of the fridge before and after taking out the milk and eggs. |
| **B clip** (fallback) | At a good rehearsal | The kitchen video side by side with the app. OBS for the screen, a phone for the kitchen, ffmpeg to put them side by side. |
| **C clip** (fallback) | At a good rehearsal | A screen recording of the stage view during C. |
| **Backup video** (the whole demo) | 15:30–16:00 | One clean full run. |

## Fallbacks

| Beat | If it fails |
|---|---|
| B | Use the replay hotkey for the camera, or cut to the B clip if the stream dies. |
| C | Type the line instead of speaking it, then fall back to the C clip. |
| F | Honza texts the courier the cue, and the subtitles carry the story. |
| The whole demo | The backup video. |

## Build (owners suggested, swap freely)

| | Kryštof | Honza |
|---|---|---|
| **By 12:00** | Pick the language. Seed the household profile. | Check that the hub returns snapshots, and capture the B frames. Get the Rohlík OAuth token. Get a Twilio account and number, and ask about the courier's language. |
| **By 13:30** | The craving is saved where every conversation sees it. Coldex's voice in the browser sounds good (ElevenLabs). | Real camera → inventory works end to end. A real cart fills from the agent. The tunnel is up. |
| **13:30–15:30** | The C turn, fast and narrated, with reasons on each item. The stage view: the B analysis card, the C cards, subtitles, hotkeys, and the mini browser. | The courier call: briefing prompt, allowlist, audio to the stage, both-sides transcript. Record the D/E checkout. Remove the emoji and sparkle icons from the UI. |
| **15:30–17:45** | Record the backup video and the B and C clips. Rehearse at least 3 runs. Code freeze at 16:45. | The same. Also brief the courier and agree on a cue. |

## Before the slot

- [ ] The language is decided, and the lines and voice match it.
- [ ] C's timing has been checked in rehearsal.
- [ ] The cameras are on USB power, and the B replay frames are loaded.
- [ ] The travel router is up, and the tunnel URL opens on the stage laptop.
- [ ] The video call is connected, with the stage mic muted.
- [ ] A test call reaches the courier, and the audio plays on stage.
- [ ] The courier is at the entrance and knows the backup cue.
- [ ] The D/E recording, the B and C clips, and the backup video are on the stage laptop.
