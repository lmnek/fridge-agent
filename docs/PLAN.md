# Fridge Agent: Plan

Living doc. Update it when a decision changes or an open question gets answered. The short version is in `../CLAUDE.md`.

## 1. Pitch

> Your fridge has an agent. It sees what you put in and take out, reads the expiry dates, listens when you say
> "I'd love carbonara tonight", fills your Rohlík cart so you order with one tap, and gets better at running
> your kitchen every day.

Event: AI Tinkerers hackathon. **Build deadline 17:45**, then a **3-minute demo with a hard stop**. Demo slots are sometime after (time TBD).
Main judging: **creativity** and an impressive demo. That comes first.
Side prize: a **Mac mini, judged by PostHog**, for the most **self-driving and self-improving** product (§6).
We target it because the learning loop also strengthens the main demo, but never at the main demo's expense.

## 2. Where we are (13. 11., ~11:00)

Honza built **Frida** overnight and it's now merged into `main`. It's the base we build on. Read `README.md`
(Czech) for how to run it and `docs/rozhodnuti.md` for its architecture. In short:

- `backend/` (FastAPI, Python 3.13, uv) holds a Claude agent with its own tool loop, an inventory engine, the
  camera manager (Reolink plus a simulated fridge), vision (Claude, local ViT, or a cascade), Rohlík MCP,
  deals scraping, recipes, and Twilio calls and SMS.
- `frontend/` (React 19, Vite, Tailwind 4) has an orb home screen, fridge, cameras, shopping, food, analytics
  and settings screens, and voice through the browser's Web Speech API.
- **Everything runs in demo mode with no keys**, and each integration switches to live on its own via `.env`.
  110 tests pass.

Gaps against the demo we want:
1. **No learning at all.** It's our "Learns" feature and the whole side prize (§6).
2. **The voice is the browser's speech engine,** so it sounds robotic. The orb exists but isn't the all-out piece yet.
3. **No demo story yet.** There's lots of breadth (deals, store radar, analytics, delivery), so the 3 minutes need a script (§3).
4. **Design taste:** emoji on every food item and sparkle icons on buttons, both against `CLAUDE.md`. It's a quick cleanup.
5. **Language:** it's Czech end to end, and we said English (§8).

## 3. Decisions

| Topic | Decision | Notes |
|---|---|---|
| Base | **Frida** (Honza's overnight build) | Merged into `main`, and everyone works on `main`. |
| Agent core | **Frida's own agent loop on Claude.** Hermes is dropped. | The loop is done and tested (parallel tools, streaming, voice channel). Adding Hermes now would only add risk. |
| LLM | `claude-opus-5-5`, with effort `medium` for chat, `low` for voice and `high` for vision | `FRIDA_AGENT_*` in `.env`. |
| Cameras | **Reolink Home Hub + 2× Argus B310**, snapshots on door events | Placement is still open (§8). |
| Ordering | **Frida fills the Rohlík cart. A human completes the order in Rohlík via the checkout link.** | Rohlík's MCP terms say an order only completes when the customer confirms it in the e-shop. Tapping the checkout link on a phone is our approval beat. The minimum order is 749 CZK. Blocked tools are listed in `grocery/rohlik_mcp.py`. |
| Delivery | **Staged**: Honza arranges a Rohlík courier waiting nearby | |
| Notifications | **Twilio** calls, SMS and WhatsApp (already built). Telegram is dropped unless someone wants it. | "The fridge calls you" can be a live beat if Twilio is set up (§8). |
| Demo beats | Core loop + **expiry scan** + **craving → recipe** + **learning moment** | §4 |
| Self-improvement | **Household profile** plus a Scout loop with human-approved self-edits | §6 |
| Language | **Undecided** (§8) | |
| Apify | Not needed. Frida scrapes akcniceny.cz itself. | |

## 4. Demo: 3:00 run of show (draft, adapt as features land)

What's real: tracking, vision, the expiry scan, agent reasoning, the recipe, and the Rohlík cart and order.
What's staged: the courier's arrival, plus learning seeded by the simulated household (§6.2) and one live self-edit on stage.

| t | Beat | On screen |
|---|---|---|
| 0:00 | One-line pitch. The app shows the home orb and the live fridge. | Home |
| 0:15 | Unpack groceries into the fridge. Scan the yogurt's date with the phone, and take out the **last milk**. | Items appear in the timeline, "milk: out" |
| 0:40 | Frida reacts on her own: "You're out of milk, and the chicken expires tomorrow." This could be a **phone call on stage**. | Timeline, or an incoming call |
| 1:00 | **Voice** to the orb: "I'd love carbonara tonight." She checks the fridge, gives a recipe that uses what's expiring, and puts the missing items in the Rohlík cart, choosing **oat milk** because she learned the household drinks it. | Orb, recipe, cart, "remembered: oat milk" |
| 1:40 | **Learning beat**: "What Frida learned" shows the household profile and the measured curve from the sim. Frida proposes an edit to her own rules, and we approve it live. | Learning panel (§6) |
| 2:15 | The checkout link goes to the phone, and we tap **Order** in Rohlík. | Rohlík order confirmation |
| 2:35 | **The courier walks in** with the bag. | |
| 2:50 | Close: "She watched, learned, and ordered. All we did was open the fridge." | |

Rules: rehearse at least 3 full runs and record a **backup video** of a clean run. Every beat needs a
manual trigger. The camera simulation panel ("Vezmi mléko" and similar) and `POST /api/camera/trigger` are the fallbacks.

## 5. Feature tiers

- **Demo path (must):** real camera in/out tracking, proactive reaction, expiry scan, craving → recipe → cart,
  checkout link → real order, learning beat, a voice orb that sounds good.
- **Should:** design cleanup (no emoji or sparkles), a live phone call from Frida, English (if chosen).
- **Leave as is, don't invest:** deals, the store radar, price history, analytics, delivery links, and local
  ViT. They're fine as B-roll and not part of the 3 minutes.
- **Cut:** Hermes, Telegram, Apify, the 3D fridge, the courier phone call.

## 6. Self-driving + self-improving: the side prize

**The Mac mini side prize is judged by PostHog: "how to make the product self-driving and self-improving".**
Mirror their definition on purpose ([self-improving loop](https://posthog.com/docs/self-driving/self-improving-loop)):
*collect signals → group into reports → an agent investigates → it proposes a change → a human reviews it →
it measures whether the metric moved, and the result becomes new signals*. In their words, "nothing reaches
production on its own". Integrating PostHog is **not required**.

**Self-driving:** Frida already notices run-outs and expiry dates on camera events and notifies or calls
without being asked. Humans only approve, and nothing gets ordered on its own.
**Self-improving:** the loop closes on *measured outcomes*. Frida reads her own metrics, changes her own
behaviour, and proves the change helped.

### 6.1 Where it plugs into Frida
New module `backend/frida/learning/` plus one frontend panel. It barely touches existing code:
- **Signals:** `EventLog.on_event(callback)` (`events.py`) already sees every event. Add the missing ones:
  recipe suggested, cooked or skipped; cart edited; detection corrected; tool calls and seconds per agent task.
- **Profile in context:** the agent's system prompt stays fixed (for cache), and per-turn state goes through
  `context_message(extra=...)` (`agent/prompts.py`, called in `agent/brain.py`). The household profile and
  the learned rules go there.
- **Tools:** add `remember_about_household` and `get_household_profile` to `TOOLS` in `agent/tools.py`.
- **Storage:** `DocStore` collections (`db.py`), e.g. `profile`, `rules`, `proposals`.

### 6.2 The loop
1. **Log signals** (above).
2. **Scout.** It runs on a schedule and from a button on stage (`POST /api/learning/review`). One Claude call
   reads the metrics, finds the weakest spot ("40 % of my recipe suggestions get skipped, mostly ones over 30 min"),
   and **proposes an edit to its own rules** as a diff with a reason.
3. **Human review.** The proposal shows in the learning panel with Approve / Decline (and optionally goes by SMS).
4. **Measure.** The approved rule becomes a new version, and the next Scout run compares the metric before
   and after. That result is a new signal.
5. **Earned autonomy.** After N approved carts for an item with no edits, Frida asks "should I always add
   milk when it runs out?" Autonomy grows within an explicit opt-in cap. It stays a cart, never an order.

### 6.3 Simulated household: a real curve in hours
A second LLM plays the family. It has hidden traits (vegetarian kid, hates coriander, oat milk, cooks only on
weekdays) and runs "simulated days" against the real agent API. Run sim days, let the Scout review and
propose, approve, and run more days. The result is a **measured learning curve** (suggestion acceptance
rising, corrections and tool calls per cart falling), charted in the panel and labelled as simulation on stage.

### 6.4 Learning ideas, ranked by demo value
1. **Household profile:** diets, allergies, favourite recipes, brands and who eats what, learned from
   conversation and corrections rather than a form.
2. **Learned product picks:** after the first cart, remember which Rohlík product each item maps to. Show
   "cart #1 took 14 tool calls and 50 s, cart #3 took 3 calls and 9 s".
3. **Vision self-correction:** "that's oat milk, not cow milk" becomes a visual hint in future vision prompts.
4. **Consumption model:** Frida already predicts run-outs. Show predicted vs actual getting closer.
5. **Recipe feedback:** cooked, skipped or "too spicy" re-rank suggestions.
6. **Waste learning:** items that get binned lead to smaller packs.
7. **Nightly reflection:** a changelog of her own rules.

## 7. Workstreams (owners TBD, all four must happen)

Suggested split by who knows the code. Swap freely.

| Workstream | Scope | Suggested owner |
|---|---|---|
| **Learning loop** | §6: `backend/frida/learning/`, signals, profile, Scout, sim household, learning panel | Kryštof (new code, no collisions) |
| **Demo script + staging** | Run of show (§4), triggers, seed data, courier, groceries, network, backup video | Kryštof (needs the whole story) |
| **Real hardware + Rohlík** | Reolink hub on site, camera placement, Claude vision on real snapshots, Rohlík OAuth token, a real cart end to end | Honza (wrote these integrations) |
| **Realtime voice orb** | Replace the Web Speech voice with a realtime voice model behind the orb, reusing `tool_definitions` / `run_tool` | Honza (wrote the frontend and voice) |

Timeline, scheduled backwards from the **17:45 build deadline**:
- **By 12:00:** decide the language. Hardware: hub snapshots work. Rohlík: token works.
- **By 13:30:** real camera → inventory → agent reaction runs end to end. The learning profile appears in the agent's context.
- **13:30–15:30:** the voice orb, the Scout loop with the sim curve, the learning panel, design cleanup.
- **15:30–16:00:** record the backup video.
- **16:00–17:45:** rehearse full 3-minute runs. **Code freeze at 16:45**, after which only demo-blocking fixes go in.
- **After 17:45, until our slot:** more rehearsals, and re-check the hardware just before going on.

## 8. Open questions

- [ ] **Language**: Czech as built, English throughout, or an English agent with the Czech UI? Changing only
      the agent is one file (`agent/prompts.py`) plus the voice language. A UI sweep touches every frontend file,
      so do it once, close to freeze.
- [ ] **Reolink**: on-demand snapshots of both cams through the hub? Wake latency? Wi-Fi through a closed
      fridge door? Cold kills batteries, so run on USB power. Honza's notes are in `docs/integrace/reolink-kamera.md`.
- [ ] **Camera placement**: both inside (Frida's default: "Police" and "Dveře") or one outside facing the fridge?
- [ ] **Rohlík**: get the OAuth token (MCP inspector "Quick OAuth Flow", see `docs/integrace/rohlik-mcp.md`),
      check that the cart and checkout link work live, and clear 749 CZK.
- [ ] **Twilio**: do we have an account with a CZ-capable number and a public URL (Cloudflare Tunnel)? Is
      the phone call a demo beat?
- [ ] **Network**: the hub, cams and laptop must share a LAN, and venue Wi-Fi often isolates clients, so
      **bring a travel router or hotspot**.
- [ ] **Courier** (Honza): contact, time window, contents of the bag, cue signal.
- [ ] **Schedule**: when is our demo slot? Can we touch code between 17:45 and the slot?

## 9. References

- Frida: `README.md`, `docs/napojeni.md` (integrations and per-service tests), `docs/rozhodnuti.md`
  (architecture), `docs/integrace/*` (research notes on Reolink, Rohlík, Twilio, vision, deals).
- Rohlík MCP: https://www.rohlik.cz/en-CZ/mcp-docs
- PostHog self-improving loop: https://posthog.com/docs/self-driving/self-improving-loop
