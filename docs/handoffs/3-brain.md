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

## Done when

- **The lines match DEMO.md**, checked over several runs, because the model varies:
  - no filler before tool calls (it says "Got it, I'll update what's missing…" today);
  - the B camera reaction is "That was the last of the milk and the eggs.", without the yogurt aside;
  - C follows the script's shape, including Lidl against Rohlík and the banana sale, and bananas get the
    *−20 % sale* tag.
- **`show_cart`**: a tool the model calls with every item (reason, quantity, price, image), which publishes the
  `cart` event for C4. It's needed because the real Rohlík MCP cart has no reasons, and the bridge never sees it.
- **`show_shops`** for C3.
- **Input transcription** is on in the session config, so the humans' speech gets subtitles (part 1).
- **Voice and language:** pick the best Realtime voice and decide the language (PLAN §8). Either is one line.
- **Real Rohlík mode:** C fills the real cart through the MCP and also calls `show_cart`. Test this with part 5.
- **It survives a judge** who complains or craves something else. Try a few variations, like a different dish or a different missing item.

## Where

`bridge/memory/`, `bridge/try_demo.py`, and the tools and session section of `bridge/main.py`.

## Parallelize

1. Tune the prompt in a loop with `try_demo.py`, running it 3 times per change.
2. Add `show_cart`, `show_shops` and input transcription.
3. Write variation scenarios (other cravings and complaints) into `try_demo.py`.

## Risks

- The model varies between runs, so judge it by several runs, never one.
- Every extra tool call in C costs time. Stay under about 25 s.
