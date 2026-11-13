# 7. Telegram

Beat H, plus the judge's question about everyday use from the phone (PLAN §2.1).

## Goal

At the close, the presenter holds up the phone with the Coldex Telegram chat, mirrored to the projector:
"And you can do all of this from your pocket." The chat filled up during the demo with what Coldex actually
did, so it's real.

## Done when

- A Coldex bot exists, and the bridge forwards the right bus events to the presenter's chat as short messages
  in Coldex's voice, not logs:
  - milk and eggs ran out (`inventory` from vision, or `learned` with category `missing`);
  - carbonara noted (`learned` with category `craving`);
  - the cart is ready, with the total and the checkout link (`cart`);
  - the order is placed and the courier is on the way (`approval` or `stage`);
  - Coldex is calling the courier (`call`).
- The phone screen shows on the projector: scrcpy for Android, QuickTime over a cable for an iPhone on a Mac.

## Step 2, only once C rehearses cleanly

Two-way text, so it holds up when a judge messages the bot. Incoming messages go to a small loop with the
same tools, memory and `instructions.md` as the voice sessions. Don't add a separate brain with its own
memory, because then the phone and the fridge would disagree.

## Where

`bridge/telegram.py` (new), which subscribes to the bus and is mounted from `bridge/main.py` in a few lines.

## Needs

A bot token from @BotFather and the presenter's chat ID, in `bridge/.env`.

## Parallelize

1. The bot and the event forwarding.
2. Phone mirroring and setting up the H shot.
3. Step 2.

## Fake mode

The chat as it was filled during a rehearsal run.

## Update: step 1 is built (fake until the token lands)

`bridge/telegram.py` subscribes to the bus and posts one short message per beat, from templates (no model
call, no OpenAI spend). `GET /telegram` (`/api/telegram` through the app) shows the chat since the last stage
reset. Without `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `bridge/.env` it's the `HACK(demo)` fake chat:
the bridge log prints `[telegram, fake] ...` for every message instead of sending it.

| Event | Message |
|---|---|
| `vision` `done` with `removed` | "Lactose-free milk and eggs just ran out. I'll put them in the next order." |
| `learned` | craving: "Noted. Craving carbonara tonight. I'll plan the order around it.", missing: "Noted. ... It goes in the next order.", others: "... I'll remember that." |
| `cart` | "Your Rohlík cart is ready, 812 Kč:" and one line per item (qty × name (why tags)), plus "Check out here: ..." if the event has `checkout_url` |
| `approval` | pending: "The cart is waiting for your OK in the app, 812 Kč.", approved: "Order placed, 812 Kč. The courier is on the way." |
| `stage` `DE` | "Order placed, 812 Kč. The courier is on the way." (once per run, skipped if an approval already said it) |
| `call` | dialing: "Calling the courier to tell them where to bring it.", ended after answered: "Talked to the courier. They're on their way up." |
| `stage` `G` | "Delivered. Enjoy dinner." (once per run) |

A `stage` reset starts a new run. Checked by `test_telegram.py` and by posting part 2's whole A–H fixture run
to a live bridge's `POST /events`.

### Human steps (about 5 minutes)

1. In Telegram, open **@BotFather** and send `/newbot`. Name it `Coldex`, and pick a username ending in `bot`
   (e.g. `coldex_fridge_bot`).
2. Put the token BotFather replies with into `bridge/.env` as `TELEGRAM_BOT_TOKEN=...`. Optional, in BotFather:
   `/setuserpic` (the Coldex mark), `/setdescription` and `/setabouttext`.
3. On the **presenter's phone**, open `t.me/<username>` and tap **Start**.
4. `cd bridge && uv run python telegram.py` prints `TELEGRAM_CHAT_ID=...`. Add that line to `bridge/.env`.
5. Run `uv run python telegram.py` again. The phone gets "Coldex is connected. I'll post here what I do in the kitchen."
6. Restart the bridge. Its log says `[telegram] live`.

### Watch out

- Every bridge that reads a `bridge/.env` with the token posts, and agents copy the main `.env` into their
  worktrees. Before the slot, clear the chat's history on the phone and do one clean rehearsal run, so the chat
  shows a single run. That run is also the fallback if the live one doesn't post.
- The Z and X fallbacks play the run only on the stage screen, so they post nothing. The chat then still shows
  the last rehearsal.
- Step 2 (two-way) isn't built.
