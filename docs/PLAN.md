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
5. **Language:** English, including the courier call (§8).

### 2.1 Judge feedback (13. 11., midday)

One of the judges told us:
- **UX is extremely important.**
- He likes **talking to the fridge**: complaining about what's missing and saying what he has a taste for.
- We should work out **how good it is to use day to day**, for example controlling it from the phone.

What follows:
- **Talking is the product.** B and C should feel like a conversation with the fridge, not commands. Decided:
  in B, Coldex notices the milk and eggs first, the actor complains and craves, and Coldex confirms both (DEMO.md).
- **Complaints are handled (done).** `bridge/memory/instructions.md` treats "we're out of X" as fact: X leaves
  the inventory and goes in the next order. Coldex never argues or asks you to check.
- **Phone control:** decided, see §8.

## 3. Decisions

| Topic | Decision | Notes |
|---|---|---|
| Base | **Frida** (Honza's overnight build) | Merged into `main`, and everyone works on `main`. |
| Agent core | **Realtime-first: one OpenAI Realtime session per screen** (`bridge/` + `app/`). The old Frida build is a parts bin. Hermes is dropped. | Verified 13. 11.: C ran in 16.5 s with the right cart. The parts and their handoffs are in `docs/handoffs/`. |
| LLM | `claude-opus-5-5`, with effort `medium` for chat, `low` for voice and `high` for vision | `FRIDA_AGENT_*` in `.env`. |
| Cameras | **Reolink Home Hub + 2× Argus B310**, snapshots on door events | Placement is still open (§8). |
| Ordering | **Frida fills the Rohlík cart. A human completes the order in Rohlík via the checkout link.** | Rohlík's MCP terms say an order only completes when the customer confirms it in the e-shop. Tapping the checkout link on a phone is our approval beat. We have a Rohlík pro account, so there's no minimum order. Blocked tools are listed in `grocery/rohlik_mcp.py`. |
| Delivery | **Staged**: Honza arranges a Rohlík courier waiting nearby | |
| Notifications | **Twilio** calls, SMS and WhatsApp (already built). Telegram is dropped unless someone wants it. | "The fridge calls you" can be a live beat if Twilio is set up (§8). |
| Demo beats | Core loop + **expiry scan** + **craving → recipe** + **learning moment** | §4 |
| Self-improvement | **Household profile** plus a Scout loop with human-approved self-edits | §6 |
| Language | **English**, including the courier call | Decided 13. 11. |
| Scraping | **Honza scrapes grocery prices and deals** (handoffs, part 8). Apify credits are there if it helps. | Feeds the C3 overview and the sale tags. |

### 3.1 Honza's simpler version: one OpenAI Realtime session (`bridge/` + `app/`)

Status: built, not decided against Frida. A single OpenAI Realtime session in the browser is the whole
brain: voice, vision (camera photos as image input) and tools. Rohlík plugs in as a remote MCP server
inside that session. The server is one FastAPI file in `bridge/` (port 8100, so it runs next to Frida on
8000) and the app is one screen in `app/` (port 5174) with no emoji, sparkles or glass. Frida in
`backend/` and `frontend/` is untouched. It covers the "Realtime voice orb" workstream (§7) in its
simplest form. How it works: `REALTIME.md`. Keys: `SETUP.md`. Not yet run against OpenAI with a real key.

## 4. Demo

The script, setup, fallbacks and build list are in **[DEMO.md](DEMO.md)**, which replaces the earlier draft here.
The learning shown in the demo is the household profile (diets, brands, weekly basics) inside beat C. The full
self-improvement loop in §6 is only for the side prize, if there's time.

## 5. Feature tiers

- **Demo path (must):** real camera in/out tracking, a craving saved from the kitchen, one cart that combines what ran out, the craving and the profile,
  checkout link → real order, the stage view with subtitles, and the courier call (see DEMO.md).
- **Should:** design cleanup (no emoji or sparkles), English (if chosen).
- **Leave as is, don't invest:** deals, price history, analytics, delivery links, local ViT, and the expiry scan
  (the store radar is reused in C3). They're fine as B-roll and not part of the 3 minutes.
- **Cut:** Hermes, Telegram, Apify, the 3D fridge, and the self-edit and learning-curve beats (side prize only, §6).

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

## 7. Workstreams

See the build table in [DEMO.md](DEMO.md#build-owners-suggested-swap-freely).

## 8. Open questions

- [x] **Language**: English throughout, including the courier call (decided 13. 11.).
- [ ] **Reolink**: on-demand snapshots of both cams through the hub? Wake latency? Wi-Fi through a closed
      fridge door? Cold kills batteries, so run on USB power. Honza's notes are in `docs/integrace/reolink-kamera.md`.
- [ ] **Camera placement**: both inside (Frida's default: "Police" and "Dveře") or one outside facing the fridge?
- [ ] **Rohlík**: get the OAuth token (MCP inspector "Quick OAuth Flow", see `docs/integrace/rohlik-mcp.md`),
      check that the cart and checkout link work live.
- [ ] **Twilio**: do we have an account with a CZ-capable number and a public URL (Cloudflare Tunnel)? Is
      the phone call a demo beat?
- [ ] **Network**: the hub, cams and laptop must share a LAN, and venue Wi-Fi often isolates clients, so
      **bring a travel router or hotspot**.
- [ ] **Courier** (Honza): contact, time window, contents of the bag, cue signal.
- [x] **Phone control** (from the judge, §2.1). **Decided: Telegram, shown in H** (DEMO.md). Step 1: the bridge
      posts Coldex's events into a Telegram chat (one-way, no second brain, no Hermes). Step 2, only once C
      rehearses cleanly: two-way text, a small loop in the bridge with the same tools, memory and
      `instructions.md`, so "do all of this from your pocket" holds up when a judge messages it. The options were:
      1. **The same web app on the phone** (recommended). Open the tunnel URL and add it to the home screen. The
         Realtime app already has a mobile layout, and it shares the bridge, memory and cart, so a craving said
         at the fridge is known on the phone. Almost no new code.
      2. **A Telegram bot.** It's familiar and can push messages, but it needs a second brain (Realtime is voice
         over WebRTC, Telegram is text and voice notes) sharing the same tools. About 1.5 h, and §3 cut it.
      Where it goes in the demo: the 3:00 is full and the courier is the climax, so a separate phone beat at the
      end weakens the close. Cheaper options: say C's "let's order now" into the presenter's phone while the
      projector shows the stage view (Coldex's voice then has to reach the stage speakers from the phone, and
      the stage view has to follow tool calls through the bridge), a few seconds of the phone in H, or keep it
      for Q&A.
- [ ] **Schedule**: when is our demo slot? Can we touch code between 17:45 and the slot?

## 9. References

- Frida: `README.md`, `docs/napojeni.md` (integrations and per-service tests), `docs/rozhodnuti.md`
  (architecture), `docs/integrace/*` (research notes on Reolink, Rohlík, Twilio, vision, deals).
- Rohlík MCP: https://www.rohlik.cz/en-CZ/mcp-docs
- PostHog self-improving loop: https://posthog.com/docs/self-driving/self-improving-loop
