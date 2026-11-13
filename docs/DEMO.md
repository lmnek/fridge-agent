# Coldex: demo script (3:00, hard stop)

This is the source of truth for the demo, and every build task should serve a beat here. The letters are stable
IDs, so use them in tasks and commits (e.g. "C4 cart card"). Lines are written in English. The language is still
open (PLAN §8), so translate them if we go Czech.

## Setup

- **Kitchen** (separate room): the fridge with 2 Reolink cameras inside, the hub, and the backend laptop on our
  own travel router. A tablet or phone at the fridge runs Coldex voice. A second phone on a tripod streams the
  kitchen to the stage over a video call.
- **Stage:** the presenter's laptop and the projector, running the **stage view** (below). The app is opened
  through the Cloudflare Tunnel URL.
- **Audio:** one path at a time. During B the stage plays the call audio, with the stage mic muted on the call.
  From C on, the call audio is muted and Coldex plays through the stage speakers.
- **People:** the actor in the kitchen, the presenter on stage, and the courier waiting in the hallway.

## Script

| | Time | What happens | Side panel |
|---|---|---|---|
| **A: Opener** | 0:00–0:10 | Presenter: "This is Coldex, an autonomous agent that runs your fridge: what's inside, what you eat, and what gets ordered. Let's watch it work." | Coldex idle, with a quiet fridge summary |
| **B: Kitchen** | 0:10–0:40 | The stream (large inset) shows the actor opening the fridge and taking out the milk and eggs. The actor: "I'm craving carbonara tonight." Coldex: "Noted, carbonara." | The camera snapshot with detection boxes. The milk and eggs fade out, and a carbonara craving card drops in. |
| **C: Order** | 0:40–1:20 | Presenter: "Let's order now, please." The stream shrinks to a corner. Coldex: "Ordering three things. What just ran out: milk, lactose-free as always, and eggs, which carbonara needs anyway. For tonight: guanciale and spaghetti, with a gluten-free pack for Anna. And your weekly basics: yogurt, and bananas, which are on sale today. Lidl is 400 m away, but Rohlík delivers within the hour, so Rohlík. 812 Kč, ordering now." | **C1** fridge check, with the missing items highlighted. **C2** carbonara broken into ingredients, each marked have or missing. **C3** a map with a radar sweep, Lidl at 400 m against Rohlík within the hour. **C4** the cart: rows with image, quantity and price, plus a why tag (*ran out*, *for carbonara*, *gluten-free · Anna*, *lactose-free*, *weekly*, *−20 % sale*). The total counts up toward the 749 Kč bar. |
| **D: Real order** | inside E | The Rohlík order is confirmed off screen. | |
| **E: Fast forward** | 1:20–1:35 | The clock speeds up. "Order placed." "Courier on the way." | Order sent: confirmation, delivery slot, and a "courier on the way" progress line |
| **F: Courier call** | 1:35–2:25 | Coldex phones the courier live through the speakers: "Hi, this is Kryštof's agent. You're delivering his Rohlík order. Skip the door and come straight onto the stage." | Call card: courier caller ID and a call timer |
| **G: Courier** | 2:25–2:45 | The courier walks onto the stage with the bag. | Delivered: a check mark |
| **H: Close** | 2:45–3:00 | "It noticed, decided, ordered and called. We just opened the fridge." | Coldex idle again |

**Live subtitles for everything anyone says** (Coldex, the actor, the presenter, the courier) run under the orb
from A to H. If the audio fails, the text still carries the story.

## Stage view (frontend, `frontend/src/features/stage/`)

- Layout: the speaking orb on the left, the side panel on the right, and the kitchen stream as an inset that's
  large in B and small afterwards.
- **The side panel follows the agent's tool calls, not a script.** The backend already streams tool calls to the
  UI, so the panel switches cards based on which tool is running. It stays truthful and adds no latency.
- Reuse Frida's existing pieces: the orb, the store radar, the cart panel, the tool-step chips and the call
  layer. Animate with `motion`, which is already installed. Design rules are in `CLAUDE.md`, with no emoji.
- A hotkey lets the presenter type "Let's order now, please" if speech recognition fails.
- Priority if time runs short: C4 cart, then C3 map, then E order sent, then F call, then B, C1 and C2.

## Must be real in the data

- **Household profile, seeded:** lactose-free milk, Anna is gluten-free, usual brands, and weekly basics (yogurt, bananas).
- **The kitchen craving** is saved where every conversation sees it (the profile or timeline in the agent's
  context), not only in the kitchen conversation's history.
- **Every cart item carries a reason**, which feeds the why tags.
- **The cart clears 749 Kč**, the Rohlík minimum order.
- **Speed:** C's agent turn takes about 25 s. Store each item's Rohlík product IDs ahead of time, batch the
  Rohlík searches (4 per call), and stream the narration while tools run.

## Fallbacks

| Beat | If it fails |
|---|---|
| B | Cut to the pre-recorded clip of B. If the cameras miss something, use the camera simulation buttons. |
| C | Use a pre-filled cart, plus Coldex's spoken summary. |
| D | The order is placed by hand in Rohlík before the demo. |
| F | The "call" plays through the laptop speakers, with Honza playing the courier from his phone. |
| The whole demo | The backup video. |

## Build (owners suggested, swap freely)

| | Kryštof | Honza |
|---|---|---|
| **By 12:00** | Pick the language. Seed the household profile. | Check that the hub returns snapshots. Get the Rohlík OAuth token. Get a Twilio account and number. |
| **By 13:30** | The craving is saved where every conversation sees it. Coldex's voice in the browser sounds good (ElevenLabs). | Real camera → inventory works end to end. A real cart fills from the agent. |
| **13:30–15:30** | The C turn, fast and narrated, with reasons on each item. The stage view with subtitles. | The courier call (briefing prompt, allowed number, audio and transcript to the screen). Remove the emoji and sparkle icons from the UI. The tunnel. |
| **15:30–17:45** | Record the backup video and the B clip. Rehearse at least 3 runs. Code freeze at 16:45. | The same. Also brief the courier and agree on a cue signal. |

## Before the slot

- [ ] The language is decided, and the lines and voice match it.
- [ ] C's timing has been checked in rehearsal.
- [ ] The cameras are on USB power.
- [ ] The travel router is up, and the tunnel URL opens on the stage laptop.
- [ ] The video call is connected, with the stage mic muted.
- [ ] The courier is in place and knows the cue.
- [ ] The backup video and the B clip are on the stage laptop.
