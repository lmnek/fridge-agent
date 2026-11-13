# Handoffs

One file per part of Coldex. Each part is sized for one agent that drives its own subagents in parallel. To
start one, give it this:

> Read `CLAUDE.md`, `docs/DEMO.md`, `docs/handoffs/README.md` and `docs/handoffs/<part>.md`, then build the part.
> Stay inside its files and work with subagents in parallel where the file says so.

| Part | Beats | Suggested owner |
|---|---|---|
| [1. Stage view](1-stage-view.md) | A–H | Kryštof |
| [2. Side panel cards](2-cards.md) | B, C1–C4, D/E, F, G | Kryštof |
| [3. Brain: prompt, memory, tools](3-brain.md) | B, C | Kryštof |
| [4. Cameras and vision](4-cameras-vision.md) | B | Honza |
| [5. Rohlík](5-rohlik.md) | C4, D/E | Honza |
| [6. Courier call](6-courier-call.md) | F | Honza |
| [7. Telegram](7-telegram.md) | H | whoever frees up first |
| [8. Grocery scraping](8-scraping.md) | C3, C4 | Honza |
| [9. Brand and the orb](9-brand-orb.md) | all | Kryštof |

## How the system fits together (decided: Realtime-first)

- **Brain:** one OpenAI Realtime session per screen. The kitchen tablet runs one for B, and the stage laptop runs
  one from C on. It was verified on 13. 11.: C ran in 16.5 s with the right cart, and the stage session found
  the kitchen craving.
- **`bridge/`** (FastAPI, port 8100) holds the fridge state, the tools, the memory, the camera proxy and the
  event bus. Put new parts in new files and mount them from `main.py` in a few lines.
- **`app/`** (React + Vite, port 5174) has the kitchen page (today's `App.tsx`) and the stage view (new, `app/src/stage/`).
- **Memory** is markdown in `bridge/memory/` plus the agent's own notes in `data/notes.md` (part 3).
- **The old Frida build** (`backend/`, `frontend/`) is a parts bin. Copy components out of it and don't run it.
  The one possible exception is the voice relay in part 6.

## The interface: the event bus

Anything that should show up on stage goes through the bridge. Screens never talk to each other directly.

- `GET /api/events` is a server-sent event stream that every screen listens to.
- `POST /api/events` with `{"type": ..., ...}` lets any part publish.
- Every tool call (`POST /tools/<name>`) is published automatically as `tool` with its arguments, once at
  `start` and once at `done`. That's how the side panel follows the agent: the cards key off tool names.

| Event | Fields | Produced by | Used by |
|---|---|---|---|
| `tool` | `name`, `args`, `phase` (start, done), `ok` | bridge, automatic | every card |
| `inventory` | `items`, `source` | bridge | C1, kitchen page |
| `learned` | `fact`, `category` (craving, missing, diet, preference, habit) | `remember` tool | B craving card, Telegram |
| `recipe` | `recipe` (`title`, `have`, `missing`, `steps`) | `show_recipe` tool | C2 |
| `cart` | `items` (`name`, `qty`, `price_czk` per unit, `reason` as comma-separated why tags, `image_url`), `total_czk` | `show_cart` tool (part 3) | C4, Telegram |
| `deals` | `items` (`item`, `store`, `price_czk`, `was_czk`), `stores` (`name`, `distance_m`, or `delivery_min` for Rohlík), `scraped_at` | the deals tool (part 8) | C3 overview |
| `approval` | `approval`, `order` | bridge | Telegram |
| `look` | `reason` (motion, manual, replay) | bridge | kitchen page or the vision pipeline |
| `vision` | `phase` (captured, analysing, done), `run`, `reason`, `frames` (`when` before or after, `camera`, `url`), `boxes` (`frame` index, `label`, `status` out, new or in, `x`, `y`, `w`, `h` from 0 to 1), `removed`, `added`, `tell`, `error` | part 4 | B card, kitchen page |
| `caption` | `who` (coldex, actor, presenter, courier), `id`, `text` (so far), `final` | both apps (part 1), part 6 | subtitles, F card |
| `call` | `phase` (dialing, ringing, answered, ended), `number` (masked) | part 6 | F card, Telegram |
| `stage` | `beat` (A, B, C, DE, F, G, H, idle), `action` | hotkeys (part 1) | forces a card, fallbacks |
| `system` | `message` | bridge | error line |

The call audio is too heavy for the bus. Part 6 exposes its own WebSocket, and the stage view plays it.
**If you change a shape, update this table in the same commit.** Until a producer exists, fake its events.

## Stage contract (parts 1 and 2)

- **`app/src/stage/bus.ts`** (part 1) exports `export type BusEvent = { type: string; [k: string]: any };` and
  `useBus(): BusEvent[]`, which holds every event since the stage was reset (the SSE stream plus anything the dev
  player feeds in). If part 2 needs the type before part 1 has pushed, create the file with exactly that type line.
- **`app/src/stage/cards/index.ts`** (part 2) exports `type CardId = "B" | "C1" | "C2" | "C3" | "C4" | "DE" | "F" | "G"`
  and `cards: Record<CardId, ComponentType<{ events: BusEvent[] }>>`. A card gets the whole list and derives its
  own state from it. Cards fill whatever box the panel gives them and are designed for a 1920×1080 projector.
- **Which card shows** is part 1's call: the newest event that maps to a card wins, per the "Driven by" column in
  `2-cards.md`, and a `stage` event with a `beat` forces one.
- **`app/src/stage/cards/fixtures.ts`** (part 2) exports `demoRun: { at: number; event: BusEvent }[]`, the whole
  A–H run as bus events with millisecond offsets that follow DEMO.md. Part 1's dev player plays it, and a
  recording from a real run replaces it later.
- **Ports while several agents run at once:** part 1 uses app 5181 and bridge 8101, part 2 5182/8102, part 3
  5183/8103, part 9 5184/8104 (`BRIDGE_URL=http://127.0.0.1:8101 npm run dev -- --port 5181`, and
  `uv run uvicorn main:app --port 8101`). 5174 and 8100 stay free for the humans.

## Rules

- Stay in your files and prefer new files over edits to shared ones. The hot spots are `bridge/main.py`,
  `app/src/main.tsx` and `app/src/App.tsx`: keep your edits there to a few lines.
- `git pull --rebase` before every commit, commit small and push often.
- Every part needs a fake mode marked `HACK(demo)`, so the demo survives if that part dies.
- Coldex only fills the cart. A human completes the order.
- The product is **Coldex** in the UI, the copy and the prompts.
- Everything is in **English**: the UI, the prompts and the courier call.
- **No minimum order.** We have a Rohlík pro account.
- Design: the rules in `CLAUDE.md` (no emoji, no sparkles, no gradients, no AI slop). Use the `frontend-design` skill.

## Timeline

- **14:30**: every part works end to end, on real data or its fake.
- **15:30**: polished, and rehearsals start (DEMO.md build table).
- **16:45**: code freeze.

## Human tasks (not for agents)

The Bluetooth speaker for the fridge, the travel router, the Cloudflare tunnel, phone mirroring for H, the
recordings (DEMO.md, Recordings), briefing the courier, and the rehearsals.
