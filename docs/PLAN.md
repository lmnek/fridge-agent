# Fridge Agent: Plan

Living doc. Update it when a decision changes or an open question gets answered. The short version is in `../CLAUDE.md`.

## 1. Pitch

> Your fridge has an agent. It sees what you put in and take out, reads the expiry dates, listens when you say
> "I'd love carbonara tonight", orders what's missing from Rohlík after one tap, and gets better at running
> your kitchen every day.

Event: AI Tinkerers hackathon. **Build deadline 17:45**, then a **3-minute demo with a hard stop**. Demo slots are sometime after (time TBD).
Main judging: **creativity** and an impressive demo. That comes first.
Side prize: a **Mac mini, judged by PostHog**, for the most **self-driving and self-improving** product (§6).
We target it because the learning loop also strengthens the main demo, but never at the main demo's expense.

## 2. Decisions

### 2.1 Decided by us

| Topic | Decision | Notes |
|---|---|---|
| Agent core | **Hermes Agent** (Nous Research) as the single brain | It ships a Telegram gateway, an MCP client with OAuth, an OpenAI-compatible API server, plugins and hooks, cron, and memory plus self-written skills (the side-prize angle). |
| LLM | **Anthropic Claude** | |
| Cameras | **Reolink Hub 1 + 2× Argus B310** (battery cams, 128 GB microSD) | No custom firmware, so we integrate through the hub. **Placement still open** (§5.1). |
| Ordering | **Real Rohlík cart + real order after explicit human approval** | Official MCP `https://mcp.rohlik.cz/mcp` (OAuth). Minimum order is 749 CZK. |
| Delivery | **Staged**: Honza arranges a Rohlík courier waiting nearby | |
| Voice (app) | **Try two variants, keep the better one**: (A) ElevenLabs Agent with Hermes as its LLM, (B) OpenAI Realtime handing off to Hermes | §5.5 |
| Language | **English** | |
| Demo beats | Core loop + **expiry scan** + **craving → recipe** + **learning moment** | §3 |
| Agent calls the courier | **Not in the demo** (stretch) | Too much live sync for 3 minutes. |
| Self-improvement | **Household profile** (preferences, diets, favourite recipes) as the base, plus more from §6 | |
| Apify | Free credits available. Use it for scraping if it fits. | §4 |

### 2.2 Proposed defaults (Claude's picks; change freely)

| Topic | Proposal | Why |
|---|---|---|
| Model IDs | `claude-opus-5-5` for both agent and vision. Try `claude-sonnet-5-5` on the voice path only if latency hurts. | Opus 5.5 is the current default. Measure before switching. |
| Vision | Snapshot, then one Claude call, then a structured diff `{added, removed, expiry_seen}` against the current inventory | One LLM call, not a pipeline. |
| State | A small bridge service owns it, in memory and persisted to `data/state.json` | One writer, so no DB is needed. |
| Approval gate | A Hermes `pre_tool_call` hook blocks Rohlík order placement unless an approved order exists | Real money. This is the one thing we test. |
| Telegram | Notifications plus approval from the phone, through the Hermes gateway | A phone buzzing with "approve order?" makes a good demo beat. |
| App | Vite + React + TS web app running on the laptop | Fastest option. |
| Fridge mic | Camera audio over the hub's RTSP, then STT, then Hermes. Stretch until verified. | Fallback: the app's voice mode on a device next to the fridge. |
| Scraping | Apify as one more MCP server in Hermes (e.g. leaflet deals from kupi.cz or Lidl). Stretch. | No pipeline, and possible sponsor points. |
| 3D fridge | Stretch. Ship a clean 2D view first. | |
| Self-improvement loop | Signals in the bridge event log, a Fridge Scout self-review, a human-approved self-edit, then measurement. A simulated household produces the learning curve. | Side prize (Mac mini) judged by PostHog. PostHog itself isn't required (§6). |

## 3. Demo: 3:00 run of show (draft)

What's real: tracking, vision, expiry reading, agent reasoning, recipe, cart and the order.
What's staged: the courier's arrival, plus learning seeded during rehearsals with one live learn on stage.

| t | Beat | On screen |
|---|---|---|
| 0:00 | One-line pitch. The app shows the live fridge. | Fridge view, quiet agent feed |
| 0:15 | Unpack the Lidl bag. Hold the yogurt's date up to the camera, put it in, and take out the **last milk**. | Items animate in and out, "yogurt · expires Sat" |
| 0:45 | The agent reacts on its own: "You're out of milk. The yogurt expires tomorrow, so want it in tonight's dinner?" | Agent card |
| 1:05 | **Voice**: "I'd love carbonara tonight." The agent checks the fridge: eggs yes, guanciale and pecorino no. It gives a recipe and builds the cart, and it picks **oat milk** because it learned the household drinks it. | Orb, recipe card, cart, "remembered: you switched to oat milk" |
| 1:45 | **Learning beat**: the brain panel shows what it learned and what it rewrote (profile, skill diff, "order #1 took 14 tool calls, now 3"). | Brain panel (§6) |
| 2:15 | Approval: the phone buzzes (Telegram) and the app card shows the total. Tap **Yes** and a real Rohlík order is placed. | Order confirmation and order ID |
| 2:35 | **The courier walks in** with the bag. | |
| 2:50 | Close: "It watched, learned, and ordered. All we did was open the fridge." | |

Rules: rehearse at least 3 full runs. Record a **backup video** of a clean run before the demo. Every beat
needs a manual trigger (key press or `POST /snapshot`) in case the camera is slow.

## 4. Feature tiers

- **Demo path (must):** in/out tracking, live fridge view, proactive agent message, expiry scan and nudge,
  craving → recipe → missing items to the cart, real approval → real order, learning beat, Telegram approval.
- **Stretch:** fridge-mic voice, 3D fridge, the agent phoning the courier (Honza's idea), Telegram voice notes,
  waste stats, store and deal recommendations (Apify).
- **Cut:** a custom scraping pipeline (Apify MCP instead), multi-fridge, auth or users, mobile app.

## 5. Components (proposal)

This is a draft architecture to start from. Whoever builds a part owns its interface and updates this section.

```
Reolink Hub 1 ── 2× Argus B310 (snapshots on motion, RTSP incl. audio)
      │
bridge/  Python FastAPI :8000 ── owns all state ── Claude vision
      │  ▲                                     └── GET /events (SSE) ──► app/
      ▼  │ HTTP (fridge plugin tools)
Hermes Agent :8642 (OpenAI-compatible API) ── Rohlík MCP (OAuth) ── Apify MCP ── Telegram
      ▲
app/  Vite + React + TS :5173 ── fridge view, agent feed, approval cards, voice orb
```

Bridge HTTP, first draft:
- `GET  /inventory` returns `[{id, name, qty, expires?, added_at, note?}]`
- `POST /inventory/changes` takes `{added: [...], removed: [...], source: "vision"|"agent"|"manual"}`
- `POST /snapshot` grabs frames now and runs vision. This is both the manual trigger and the demo fallback.
- `POST /approvals` takes `{items, total_czk, reason}` and returns `{id}`. `POST /approvals/{id}` takes `{approved: bool}`.
- `GET  /events` is an SSE stream of `{type: "inventory"|"agent"|"approval"|"expiry"|"learned", ...}`
- `POST /events` lets Hermes or the plugin push a feed item.

Hermes `fridge` plugin tools: `get_inventory`, `update_inventory`, `propose_order`, `post_to_app`.

Stack: Python 3.14 + uv for `bridge/` and the plugin, Node 24 + npm for `app/`. Hermes isn't installed yet
(use the official script). Planned commands: `cd bridge && uv run uvicorn main:app --reload --port 8000`,
`cd app && npm run dev`, `hermes gateway`. Fake modes: `FAKE_CAMERA=1` replays `demo/snapshots/`, and
`DEMO_SEED=1` loads the demo inventory.
Secrets: `ANTHROPIC_API_KEY`, `API_SERVER_KEY`, `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`, `APIFY_TOKEN`,
`REOLINK_HOST`/`USER`/`PASSWORD`, and the Telegram token (via `hermes gateway setup`).

### 5.1 Cameras & vision (bridge)
- Access the hub with `reolink_aio` (the Home Assistant library, which supports the Home Hub and battery-cam push
  events) or the plain Reolink HTTP API (`/cgi-bin/api.cgi?cmd=Snap&channel=N`). Take whichever works first.
- Trigger: a camera motion event, then a short delay, then snapshot(s), then a vision call. A manual
  `POST /snapshot` always works.
- Vision prompt input: the current inventory JSON, the previous snapshot, the new snapshot, and learned visual
  hints. Output: `{added:[{name, qty, expires?}], removed:[...], expiry_seen:[...]}`.
- **Placement is undecided.** The recommendation is 1 inside + 1 outside: the inside cam takes a shelf snapshot on
  every door close and drives the inventory diff; the outside cam faces the fridge and captures items in hand,
  expiry dates and the mic. Alternatives: both inside (better shelf coverage), or one plus a spare. Decide after
  the hour-1 test (Wi-Fi through the closed door, cold, IR at night inside the fridge, wake latency).
- Expiry fallback: a "scan" button in the app that uses the laptop webcam (`getUserMedia`) through the same vision call.

### 5.2 Bridge (`bridge/`, FastAPI :8000)
- State, the event feed (SSE), approvals, camera polling and vision calls. Interface draft is at the top of §5.
- It forwards meaningful fridge changes to Hermes (`POST :8642/v1/responses`, `"conversation": "fridge"`,
  `Authorization: Bearer $API_SERVER_KEY`) so the agent can react on its own.

### 5.3 Hermes (`hermes/`)
```yaml
# ~/.hermes/config.yaml
model:
  provider: anthropic
  default: claude-opus-5-5
mcp_servers:
  rohlik:
    url: "https://mcp.rohlik.cz/mcp"
    auth: oauth          # browser login on first connect, token cached in ~/.hermes/mcp-tokens/
  apify:                 # stretch: on-demand scraping (leaflet deals, recipes); verify URL + auth
    url: "https://mcp.apify.com"
    headers:
      Authorization: "Bearer ${APIFY_TOKEN}"
```
```
# ~/.hermes/.env
ANTHROPIC_API_KEY=...
API_SERVER_ENABLED=true
API_SERVER_KEY=...
```
- Plugin `hermes/plugins/fridge/`: `plugin.yaml` + `__init__.py` with `register(ctx)`, `ctx.register_tool(...)`
  and `ctx.register_hook(...)`. Handlers return JSON strings and never raise.
- Hooks: `pre_tool_call` blocks Rohlík order placement unless an approved order exists (this is the one
  check we test). `post_tool_call` on memory and skill writes pushes a `learned` event to the bridge for the brain panel.
- A system prompt or skill holds the fridge persona. Keep it short, warm and proactive, and never order without approval.
- Telegram: `hermes gateway setup`.

### 5.4 App (`app/`, Vite + React + TS)
- Screens: one main view. On the left is the fridge (shelves, items, expiry tint). On the right is the agent
  feed with cards (message, recipe, cart, approval, learned). A voice mode goes full screen with the orb. The
  brain panel is a slide-over.
- Data comes from `GET /inventory` plus `GET /events` (SSE). Chat goes to Hermes through the bridge or directly
  (CORS via `API_SERVER_CORS_ORIGINS`).
- Design taste is in `CLAUDE.md`. The orb is the one place to go all-out on motion.

### 5.5 Voice A/B
- **A, ElevenLabs Agent + Hermes as custom LLM.** ElevenLabs handles STT, TTS, turn-taking and interruptions.
  The LLM is Hermes `/v1/chat/completions`, which needs a public URL (install ngrok or cloudflared). The React
  SDK exposes input and output volume for the orb (check the method names). It keeps one brain and one memory.
- **B, OpenAI Realtime (WebRTC in the browser).** Speech-to-speech with a single tool `ask_fridge_agent(text)`
  that calls Hermes. It's the snappiest, but it's a second model. The orb uses a WebAudio `AnalyserNode` on
  the mic and remote tracks.
- Decide at 12:45. Risk for A: a tool-heavy Hermes turn may be too slow for conversational timing. Mitigation:
  short spoken acknowledgement first, details on screen.

## 6. Self-driving + self-improving: the side prize

**The Mac mini side prize is judged by PostHog: "how to make the product self-driving and self-improving".**
PostHog has a specific definition, and we should mirror it on purpose
([self-improving loop](https://posthog.com/docs/self-driving/self-improving-loop)): *collect signals → group
into reports → an agent investigates → it proposes a change → a human reviews it → it measures whether the
metric moved, and the result becomes new signals*. In their words, "nothing reaches production on its own".

**Self-driving** means the fridge runs the kitchen without anyone driving each step. It notices run-outs and
expiry dates, plans meals and builds carts unprompted, on events plus a schedule (Hermes cron). Humans only
approve. Our "nothing gets ordered on its own" is the same principle as their "nothing reaches production on its own".

**Self-improving** means the loop closes on *measured outcomes*. The agent reads its own metrics, changes its
own behaviour, and proves the change helped.

### 6.1 The loop inside the fridge (proposal)
The organisers said **integrating PostHog is not required**. The judges care about the loop, not the tool,
so we build it on our own event log, which the bridge already keeps, with no extra dependency.
1. **Log signals:** every meaningful event goes to the bridge event log: `item_added/removed`, `vision_corrected`,
   `order_proposed/approved/edited/rejected`, `recipe_suggested/cooked/skipped`, plus timing and tool-call count per agent task.
2. **Fridge Scout.** A nightly Hermes cron job, also triggerable on stage, reads *its own* metrics through a
   bridge tool (`get_metrics`). It finds the weakest spot ("40 % of my recipe suggestions get skipped, mostly
   ones over 30 min"), writes a short report, and **proposes an edit to its own skill or prompt**.
3. **Human review.** The proposal lands in the app's brain panel or on Telegram as a diff with Approve / Decline.
4. **Measure.** The approved edit becomes a new skill version, and the next Scout run compares the metric
   before and after. The result is a new signal, which closes the loop.
5. **Earned autonomy (self-driving that grows).** After N approved orders of an item with no edits, the agent
   asks "should I auto-reorder milk under 100 CZK from now on?" Autonomy rises with the approval rate, and it
   stays within an explicit opt-in budget cap. That cap is the money gate.

Optional, only if it's cheap: mirroring the events to PostHog gives us a dashboard the judges recognise, but
it isn't needed.

### 6.2 Make the curve real in hours, not weeks: a simulated household
We can't wait a week for real usage, so a second LLM plays the family. It has hidden traits (vegetarian kid,
hates coriander, oat milk, cooks only on weekdays) and runs through "simulated days" against the real agent
via the bridge and Hermes. Every interaction lands in the event log. Then we run sim days, the Scout reviews,
the agent self-edits, a human approves, and we run more sim days. The result is a **real, measured learning
curve** (proposal acceptance rising, corrections and order tool-calls falling) that the app can chart. Label
it as simulation on stage.

### 6.3 Runtime learning ideas

Make the learning **structural and visible**. Hermes already persists memory (MEMORY.md / USER.md, Honcho
user modelling) and writes its own skills. Our job is to feed it good signals and *show* the improvement.

Ideas, ranked by demo value:
1. **Household profile** (base layer). Diets, allergies, preferences, favourite recipes, brands, and who eats
   what, learned from conversation and corrections rather than a settings form. The brain panel shows
   "What I know about this household".
2. **Self-written procedures with measurable speed-up.** After the first Rohlík order, the agent writes a
   `restock` skill (product IDs it found, preferred brands, cart-building steps). Later orders reuse it. Show
   real numbers: "order #1 took 14 tool calls and 50 s, order #3 took 3 calls and 9 s". This is the most
   "recursive" claim we can prove.
3. **Vision self-correction.** When a user fixes a misdetection ("that's oat milk, not cow milk"), the agent
   stores a visual hint ("blue Alpro carton = oat milk") that is injected into future vision prompts, so the
   next detection is right. The agent improves its own perception, with a before/after you can see.
4. **Consumption model.** From the event log it learns how fast things go ("milk lasts about 3 days") and
   restocks *before* you run out. It can show predicted vs actual run-out to prove it's getting better.
5. **Recipe feedback loop.** Cooked it, skipped it, "too spicy" all re-rank suggestions and grow the favourites list.
6. **Waste learning.** Items that expire unused lead it to buy smaller packs or less often ("you binned half the
   spinach twice, so I'm switching to the small bag").
7. **Nightly reflection (cron).** The agent reviews the day's log (corrections, wrong predictions, slow orders)
   and rewrites its own skills and rules. The brain panel shows a **changelog of its own brain** (a diff of
   the skill files). This is literally an agent improving its own instructions.

Demo plan: 1 is the foundation. The learning beat (§3, 1:45) shows the learning curve from the sim,
plus one Scout proposal (a diff of its own skill) that we approve live. Idea 2's numbers go on the brain
panel. Instrument from the very first commit so the numbers are real by demo time.

## 7. Lanes & timeline (proposal)

Owners get assigned at kickoff. Each lane runs its own agents, and the interfaces in §5 are the seams.

| Lane | Scope | Directory |
|---|---|---|
| A: Eyes | Reolink access, snapshots, vision diff, bridge state + SSE | `bridge/` |
| B: Brain | Hermes install, fridge plugin, approval hook, Rohlík MCP, Telegram, learning signals + brain panel data | `hermes/` |
| C: Face | App: fridge view, feed, cards, brain panel, design | `app/` |
| D: Voice | A/B voice variants and the orb (can merge into C) | `app/` |
| E: Stage | Courier staging with Rohlík, groceries, fridge setup, network, run of show, backup video | `demo/` |

Scheduled backwards from the **17:45 build deadline**:
- **First hour after start:** setup, plus each lane resolves its open questions (§8).
- **Until 11:45:** every lane works on its own with fakes.
- **By 12:45:** first end-to-end run: real camera, inventory, agent, approval, Rohlík cart.
- **12:45:** pick the voice variant.
- **12:45–14:45:** demo beats: expiry, craving → recipe, learning panel, Telegram approval.
- **14:45–15:45:** polish, seed data, fake modes, record the backup video.
- **15:45–17:45:** rehearse full 3-minute runs. **Code freeze at 16:45**, after which only demo-blocking fixes go in.
- **After 17:45, until our slot:** more rehearsals, and re-check the hardware just before going on.

## 8. Open questions (verify in hour 1)

- [ ] **Reolink**: can we pull on-demand snapshots of both cams through the hub? What's the wake latency? Do motion
      events push or do we poll? Is audio in the RTSP stream? Does Wi-Fi get through a closed fridge door? Cold
      kills batteries, so run on USB power.
- [ ] **Camera placement**: decide after the test (§5.1).
- [ ] **Rohlík MCP via Hermes**: does the OAuth login work from Hermes? What's the real tool list? **Can it place an
      order, or only fill the cart?** (A press report says in-chat checkout works without 3-D Secure.) If it's
      cart only, checkout in the Rohlík app is still a real order. The cart must clear 749 CZK.
- [ ] **Hermes**: API server and a hello-world plugin running. How long does a tool-using turn take (voice
      viability)? Can images pass through the API? Where exactly do memory and skill files live (for the brain panel)?
- [ ] **Network**: the hub, cams and laptop must share a LAN, and venue Wi-Fi often isolates clients, so
      **bring a travel router or hotspot**.
- [ ] **Courier** (Honza): contact, time window, contents of the bag, cue signal.
- [ ] **Apify**: hosted MCP URL and auth (Bearer token or OAuth)? Is there a ready actor for Czech leaflet deals
      (kupi.cz, Lidl, Kaufland), or does the generic web scraper do it? Do the hackathon credits cover it?
- [ ] **Schedule**: when is our demo slot? Can we touch code or hardware between 17:45 and the slot, or is 17:45 a hard submission?
- [ ] **Telegram**: bot token. Approval UX: is a text "yes" enough, or can Hermes send inline buttons?

## 9. References

- Hermes Agent docs: https://hermes-agent.nousresearch.com/docs (index: `/docs/llms.txt`). Key pages:
  API server, plugins (`/docs/developer-guide/plugins`), MCP (`/docs/reference/mcp-config-reference`),
  memory, skills, Telegram, voice mode, cron.
- Rohlík MCP: https://www.rohlik.cz/en-CZ/mcp-docs
- Reolink Home Hub compatibility (B310 is supported): https://support.reolink.com/hc/en-us/articles/32379509281561
