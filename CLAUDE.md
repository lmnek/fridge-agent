# Fridge Agent

## The event

AI Tinkerers hackathon. **Build deadline 17:45**, then a **3-minute demo with a hard stop**. Demo slots are sometime after the deadline (exact time TBD).
Main judging is **creativity** and an impressive demo. There's also a **side prize** (a Mac mini, judged by PostHog)
for how **self-driving and self-improving** the product is. It needs to notice, act and improve on its own, measured with real data,
with humans approving the changes. PostHog integration isn't required (see PLAN §6).
We also have free Apify credits.

Team: Kryštof and Honza, each driving several coding agents in parallel.

## The project

A fridge with an agent living in it. Cameras watch what goes in and out, and the agent keeps track of what's
inside and what's about to expire. You can talk to it, and it orders what's missing from Rohlík so a courier
shows up at the door. Over time it gets better at running the household's kitchen.

What it does:
- **Sees.** Cameras in or at the fridge track items going in and out, and the app shows the live contents.
- **Reads expiry dates.** You hold the package date up to the camera when putting an item in, and the agent
  warns you before the item goes off ("the yogurt expires tomorrow, use it tonight").
- **Listens.** You can talk to it at the fridge or in the app's voice mode. "I'd love carbonara tonight" gets
  you a recipe plus the missing ingredients.
- **Shops.** It fills a Rohlík cart, and a **human completes the real order** by tapping the checkout link.
- **Learns.** It builds a profile of the household (diets, preferences, favourite recipes, brands, how fast
  things get eaten). It also reviews its own metrics, proposes edits to its own skills, and proves
  they helped once a human approves them. This is the side-prize angle.
- **Talks back** through the app (timeline, chat, and a voice mode with an animated orb), and by SMS or a phone call.

Demo story: groceries go in and the last milk comes out. The agent notices. Someone says a craving out loud.
The agent answers with a recipe and a cart that already reflects learned preferences. Someone taps Order on the
phone, and the Rohlík courier walks in.

The app is called **Frida**. Honza built the base overnight. It runs fully in demo mode with no keys, and every
integration goes live separately via `.env`. Building blocks: Frida's own **Claude agent loop** (no Hermes),
**Reolink Home Hub + 2× Argus B310** cameras, **Rohlík's official MCP** (Frida fills the cart, and a human
completes the order in Rohlík), and **Twilio** for calls and SMS.

Layout: `backend/` (FastAPI, uv, `uv run frida serve`, tests with `uv run pytest -q`), `frontend/` (React +
Vite + Tailwind, `npm run dev`), `infra/`, and `docs/`. Honza's docs are in Czech: `README.md` covers running
it, `docs/rozhodnuti.md` the architecture, and `docs/napojeni.md` connecting the real services.

## How we work

- **The demo is the product.** Judge every task by "does this make the 3-minute demo better?" If it doesn't, skip it.
- **Speed over robustness.** Happy path first, with no defensive code for cases the demo won't hit. The
  exception is anything touching real money (ordering), which must never fire without human approval.
- **Let the agent do the work.** Prefer one agent tool plus a good prompt over a hand-built data pipeline. If
  you're writing parsing, matching or business rules, ask first whether the LLM could do it from a tool call.
- **Parallel by default.** Many agents work at once, so stay inside your area, keep the interfaces between
  parts small and written down, and commit small and often (`git pull --rebase` before pushing).
- **Faking is fine.** A partly staged demo is acceptable. Give every hardware or external piece a fake mode
  so the demo survives if it dies, and mark fakes with `HACK(demo)` so we always know what's real.
- Language: code and our docs are in English. The UI and agent language (Czech as built, or English) is still open (PLAN §8).
- Never commit secrets (`.env` is gitignored).

## Design taste

The app should be clean, simple and cool, and explicitly **not AI slop**: no purple gradients, no ✨ icons,
no "AI" badges or pill clutter, no emoji, no glassmorphism, no template-dashboard look. Bet on a few features
that are genuinely good rather than many average ones. The one place to go all-out is the **voice-mode orb**,
which should react to speech and feel deeply satisfying. Use the `frontend-design` skill for UI work.

## More

[docs/PLAN.md](docs/PLAN.md) has where we are, the decision log, the demo script, the learning-loop design, the
workstreams, and the open questions. Update it when something gets decided or verified.
