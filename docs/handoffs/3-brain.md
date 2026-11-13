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

## Update: the actor orders from the kitchen

Decided 13. 11. ~13:45 (DEMO.md B and C). The kitchen session now runs both B and C, and the stage session is
only the typed fallback. With the fridge door open, the actor says: "Coldex, we're out of milk and eggs again
and I'm craving carbonara, so order what we need." The door then closes, and the vision diff arrives a few seconds
into C. Check that:
- **C starts straight from that line.** Coldex goes into the C narration with no B reaction first. "That was the
  last of the milk and the eggs." is dropped, because "What just ran out" covers it.
- **Coldex doesn't wait for the vision diff,** and doesn't update the inventory twice.
- **The camera result arriving mid-C never starts a second spoken response** and never makes Coldex repeat
  the narration. Send it to the session as context only, or skip it once C is underway. That's item 4 above,
  with part 4's `tell_line`.

Make this the main `try_demo.py` scenario, and keep the old stage-session C as the fallback scenario.

## Measured 13. 11. ~14:35 (`try_demo.py`, "heard" = when the last audio ends, "gap" = longest silence)

- **Kitchen order (`--scenario demo`, 4 runs):** milk and eggs in the cart every time, 7 items, 685 Kč
  (DEMO.md and the scripted run now say 685 too). The camera note mid-C never started a reply.
- **Dead air is the open problem.** Tools first leaves the model silent while it writes the show_* calls:
  gaps of 8.3 and 12.0 s. Saying "What just ran out…" in step 1 brings them to 7.6 and 5.6 s, and C is
  heard until about 30 s. Narration first (as before) was worse: one run ignored the complaint (428 Kč),
  and one skipped the narration. **Fixed ~14:55:** show_cart now takes only names, quantities and reasons,
  and the bridge adds prices and pictures from the picks. Gaps 2.4 and 0.0 s, still 685 Kč, heard until
  28–31 s. Open: one of the 2 runs said "What just ran out…" again after show_cart.
- **Stage fallback:** B lines matched exactly, C had 685 Kč, a 3.7 s gap, heard until 26.6 s.
- **Judge Q&A:** "What's in my fridge?" and "What's expiring?" now answer by voice in about 1 s, with no
  card and no opener (fixed ~14:55). Open: in 1 run "What can I cook tonight?" opened with "Let me
  think…" and picked a yogurt bowl (an earlier run gave a spinach omelette, no preamble).

## Voice: marin, cheeky delivery (13. 11. ~15:30)

- **Voice** is `marin` everywhere: `REALTIME_VOICE` defaults to it in `main.py` (kitchen and stage sessions both
  use `session_config`) and in `courier.py`, and `bridge/.env` doesn't override it.
- **Cheeky delivery** is a short `## Personality` section in `instructions.md`: dry, playful, clear, at most one
  short quip after an answer, never in an order turn. `try_voices.py --narration marin` now renders cheeky.
- **The repeat fix:** step 4 now says to start with "For tonight:" if what ran out was already said in step 1.
- **The total is 685 Kč** in DEMO.md, the fixture cart (real picks: 4 milk, 2× guanciale 100 g, 4 yogurts,
  6 bananas) and try_demo.py. `c-narration.wav` re-rendered, marin cheeky, 25.5 s, read verbatim with 685.
- **Measured (`--scenario demo`, 2 runs):** "What just ran out" said once, before the tools, in both runs. 7 items,
  688 Kč (the bridge's real prices: bananas 10.24 Kč, not 9.68), first words 0.6 / 0.5 s, gaps 0.0 / 3.2 s,
  C heard until 23.2 / 26.9 s, the camera note started no reply. Both runs said "Albert is 60 meters away" and
  no banana sale, from today's real `deals.json`, so they don't match DEMO.md's Lidl and sale lines.
- `test_main.py::test_demo_cart_from_names_comes_to_the_picks_total` fails (688 != 685) for the same banana price.
