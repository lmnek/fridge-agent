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
