# 5. Rohlík

Beats C4 and D/E. This part makes the cart real and records the checkout.

## Goal

In C, Coldex fills a real Rohlík cart over 749 Kč from stored product IDs. A human completes the real order
in Rohlík, and that checkout is screen-recorded for D/E. The real courier then brings that order.

## Done when

- **The token works inside Realtime.** If Rohlík rejects it, the bridge already falls back to the fake cart.
  Find out how long the token lasts and how to refresh it.
- **Rohlík's MCP tool names are verified** (`tools/list`), and the auto-approve list in `app/src/realtime.ts`
  matches them. Read and cart calls are approved automatically, and anything else waits for a human.
- **`bridge/memory/products.md` has the real product ID, price and image URL** for all 7 items, and the
  quantities still clear 749 Kč.
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

## Fake mode

The fake cart in the bridge. The D/E recording is a recording anyway.

## Risks

- The token expires mid-demo.
- Rohlík searches inside the turn slow C down, so use the stored IDs.
- Only a human can complete the order.
