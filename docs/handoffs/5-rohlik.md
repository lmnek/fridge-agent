# 5. Rohlík

Beats C4 and D/E. This part makes the cart real and records the checkout.

## Goal

In C, Coldex fills a real Rohlík cart from stored product IDs. A human completes the real order
in Rohlík, and that checkout is screen-recorded for D/E. The real courier then brings that order.

## Done when

- **The token works inside Realtime.** If Rohlík rejects it, the bridge already falls back to the fake cart.
  Find out how long the token lasts and how to refresh it.
- **Rohlík's MCP tool names are verified** (`tools/list`), and the auto-approve list in `app/src/realtime.ts`
  matches them. Read and cart calls are approved automatically, and anything else waits for a human.
- **`bridge/memory/products.md` has the real product ID, price and image URL** for all 7 items.
- **C fills the real cart** and calls `show_cart` for the panel. Test it with part 3's `try_demo.py` in Rohlík mode.
- **The checkout link works.**
- **The real order is placed and screen-recorded** on a phone, timed with the courier delivery. The video is
  saved to `app/public/demo/checkout.mp4` for the D/E card.
- Bonus: check whether the bananas are really on sale today (`get_discounted_items`). If not, the sale stays `HACK(demo)`.

## Where

`bridge/memory/products.md` (the table only, part 3 owns the prompt), the Rohlík tool setup in
`bridge/main.py`, the auto-approve list in `app/src/realtime.ts`, and the recording.

## Parallelize

1. The token, `tools/list` and the approval list.
2. Look up the 7 products (batch search, 4 per call) and fill `products.md`.
3. Run C end to end on the real cart, together with part 3.

## Reuse

`docs/integrace/rohlik-mcp.md` (the tools, the OAuth flow and the terms) and the old `backend/frida/grocery/rohlik_mcp.py`.

## Built (13. 11., Honza)

- **`bridge/rohlik.py`**, run from `bridge/` with `uv run python rohlik.py <command>`:
  - `status`: is the token valid, and when does it expire
  - `tools`: the server's tools, with the ones Coldex may use marked SAFE
  - `search`: the top hits for every row in `products.md`, 4 per call, with the raw replies (image URLs too)
    in `data/rohlik-search.json`
  - `cart`: what's in the real cart now
  - `fill`: adds `products.md` to the real cart and prints the checkout link. It stops if the cart isn't empty.
- **The session only sees safe tools.** `session_config` passes `rohlik.SAFE_TOOLS` as `allowed_tools`, with
  `require_approval: "never"`: search, product details, cart, checkout link and discounts. Nothing in the
  session can order, cancel or claim. `AUTO_APPROVE` in `app/src/realtime.ts` lists the same exact names.
- **`try_demo.py --rohlik`** runs C against the real cart and prints the Rohlík calls.
- **For part 3 and C4:** in Rohlík mode the cart calls run on OpenAI's side, so no `tool` event reaches the
  bus. The C4 card only appears if Coldex calls `show_cart` (with reasons and image URLs) after adding to
  the Rohlík cart. The prompt has to ask for that.
- **Tested 13. 11. at 13:30:** the token works (58 tools, expires after about 6.5 h, no refresh yet).
  `/realtime/token` answers `"rohlik": true`. `try_demo.py --rohlik` filled the real cart from the product
  IDs in one `add_items_to_cart` call, done at 13.3 s.
- **For part 3, found in that run:**
  - Coldex said the bananas are on sale today. They aren't, and none of the 7 items is.
  - It never called `show_cart`, so C4 stays empty in Rohlík mode.
  - Rohlík has no Olympus yogurt, so `products.md` uses Milko and `household.md` still says Olympus.
- **This Rohlík account still shows a 749 Kč minimum** (`minimalOrderPrice`), although we expected the pro
  account to have none. The 7 items come to 684.78 Kč.

## Fake mode

The fake cart in the bridge. The D/E recording is a recording anyway.

## Risks

- The token expires mid-demo.
- Rohlík searches inside the turn slow C down, so use the stored IDs.
- Only a human can complete the order.
