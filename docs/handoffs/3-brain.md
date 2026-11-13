# 3. Brain: prompt, memory, tools

Beats B and C. This part covers what Coldex knows, what it says and which tools it calls.

## Where it stands

- **Memory is built.** `bridge/memory/instructions.md` is the prompt, `household.md` the profile, `products.md`
  the Rohlík product picks, and `data/notes.md` what Coldex noted itself. `remember` has categories (craving,
  missing, diet, preference, habit), and `get_household` returns everything fresh. Complaints ("we're out of
  milk again") are taken as fact.
- **`bridge/try_demo.py`** runs B and C as text against real Realtime and prints the speech, every tool call
  with timing, and the final cart.
- **First live run:** C took 16.5 s, first words came after 0.5 s, the two lookups ran in parallel, and the
  cart had all 7 items with reasons, 812 Kč. The stage session found the kitchen craving.

## Built (13. 11., part 3)

- **`bridge/show.py`** has `show_cart` and `show_shops`, mounted from `main.py`. `show_cart` publishes `cart`
  in the table shape, fills `image_url` from an `Image` column in `products.md`, and is also the fake cart
  (`add_to_cart` and `view_cart` left the session, `place_order` stays). `show_shops` publishes `deals` from
  `data/deals.json` (part 8 writes it in the `deals` shape) or a `HACK(demo)` sample, plus Coldex's `choice`
  and `why`. Today's sales also go into the memory, so C knows them before it plans.
- **Input transcription** is on (`REALTIME_TRANSCRIBE`, default `gpt-4o-transcribe`, English).
- **C's choreography:** "Ordering three things." with `get_inventory` and `get_household`, then the narration,
  then `show_recipe`, `show_shops` and `show_cart` in one batch, about 11 s in. C2, C3 and C4 arrive within
  a few milliseconds of each other, so the panel should queue cards and hold each for a couple of seconds.
- **`try_demo.py`** has `--scenario` (demo, no-camera, other-dish, other-missing, judge-craving, judge-edit),
  `--runs N` with a summary table, and `--voices marin,cedar,...`, which saves one WAV per voice to `data/voices/`.
- **Voice:** `marin` stays the default. To compare by ear: `cedar`, `coral`, `sage` (samples in `data/voices/`).

## Done when

- **The lines match DEMO.md**, checked over several runs, because the model varies:
  - no filler before tool calls (it says "Got it, I'll update what's missing…" today);
  - the B camera reaction is "That was the last of the milk and the eggs.", without the yogurt aside;
  - C follows the script's shape, including Lidl against Rohlík and the banana sale, and bananas get the
    *−20 % sale* tag.
- **`show_cart`**: a tool the model calls with every item (reason, quantity, price, image), which publishes the
  `cart` event for C4. It's needed because the real Rohlík MCP cart has no reasons, and the bridge never sees it.
- **Deals and shops for C3:** C reads today's scraped deals through part 8's tool, so the banana sale is real. Decide with Honza whether `show_shops` stays a separate tool or folds into that one.
- **Input transcription** is on in the session config, so the humans' speech gets subtitles (part 1).
- **Voice:** pick the best Realtime voice. The language is English (decided).
- **Real Rohlík mode:** C fills the real cart through the MCP and also calls `show_cart`. Test this with part 5.
- **It survives a judge** who complains or craves something else. Try a few variations, like a different dish or a different missing item.

## Where

`bridge/memory/`, `bridge/try_demo.py`, and the tools and session section of `bridge/main.py`.

## Parallelize

1. Tune the prompt in a loop with `try_demo.py`, running it 3 times per change.
2. Add `show_cart`, the C3 tool and input transcription.
3. Write variation scenarios (other cravings and complaints) into `try_demo.py`.

## Risks

- The model varies between runs, so judge it by several runs, never one.
- Every extra tool call in C costs time. Stay under about 25 s.

## Update: gaps after the first implementation

Checked against everything decided since this handoff was written (English, no minimum, cameras maybe not
live, the judge's feedback, Telegram, scraping). The rest is aligned. In priority order:

1. **Free conversation for the judge.** The judge likes talking to the fridge, so Q&A matters as much as the
   script. The prompt covers cravings, complaints and ordering, but not questions. Add a short section:
   "what's in my fridge?" (get_inventory, one sentence, expiring items first), "what can I cook?" (one dish
   from what's there, expiring first, show_recipe, then offer to order what's missing) and "what's
   expiring?". Test 3–4 judge-style lines in `try_demo.py`.
2. **B without cameras.** In speech-only mode the actor says "I just took the last milk and eggs". Treat
   that like the camera: update_inventory and the same line ("That was the last of the milk and the eggs.").
   Add a `try_demo.py` scenario with no camera message.
3. **Rehearsal reset.** Deleting `data/` now also wipes the scraped deals (`data/deals.json`) and the vision
   runs. Add a reset that restores the seed inventory and clears the cart, the approvals and the notes, but
   keeps the deals and the frames. Trigger it from the stage reset hotkey (the `stage` event with `action: "reset"` already exists).
4. **The camera line asks for a second update.** `vision.py` already applies the diff, but `tell_line` still
   says "Update the inventory". Agree with part 4 on "The inventory is updated, react briefly". That saves a
   tool call before Coldex speaks in B.
5. **The checkout link for Telegram.** Part 7 wants "cart ready, total, checkout link", but the `cart` event has
   no link. In real Rohlík mode, have the bridge fetch it in `show_cart` (`rohlik.py` already can), not the
   model, and add `checkout_url` to the event and the README table. Coordinate with parts 5 and 7.
6. **Low: a text channel later.** Telegram step 2 (part 7) reuses `instructions.md`. Keep the voice-only rules
   (the narration shape, "in the same breath") in their own section, so a text channel can skip them.
