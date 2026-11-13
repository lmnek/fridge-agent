# 8. Grocery scraping

Beats C3 and C4. Honza's part of the project. This part tells Coldex today's prices and deals around the flat.

## Goal

When Coldex says "bananas, which are on sale today", it's true. While it decides where to buy, the side panel
shows an overview of what was scraped: today's prices and deals for the cart items across Rohlík, Lidl and
the other nearby shops.

## Done when

- Today's prices and deals for the demo items (lactose-free milk, eggs, guanciale, spaghetti, gluten-free
  spaghetti, Greek yogurt, bananas) are scraped from the nearby shops (Lidl, Albert, and so on). Rohlík's own
  prices come from part 5. Scrape before the demo and refresh on the morning of the demo.
- The result is saved in the data folder, and a bridge tool returns it, for example `get_deals`. The tool also
  publishes the `deals` event (README table) for the C3 overview card.
- Part 3 makes C call the tool, so the sale tag and the store choice come from real data.
- Agree the tool's name and output with part 3, and the card's needs with part 2.

## Where

A new file in `bridge/` for the tool, mounted from `main.py` in a few lines. Put the scraper wherever it's
fastest: a script, or an Apify actor (we have free credits).

## Reuse

The old Frida build already scrapes deals in `backend/frida/deals/`: the akcniceny.cz and kupi.cz scrapers,
plus a basket optimizer. The research notes are in `docs/integrace/akce-a-obchody.md`.

## Parallelize

1. The scraper for the deal sites.
2. The tool, the `deals` event and a saved sample, so part 2 can build the card on it straight away.

## Fake mode

The saved scrape from the morning, marked `HACK(demo)`.

## Risks

Sites block scrapers or change their layout. Scrape early and keep the saved result as the fallback.

## Built (13. 11. 2026)

- `bridge/deals.py scrape` (about 45 s) writes `data/deals.json` in the `deals` shape, plus a committed copy in
  `bridge/replay/deals.json` that `show.py` uses before the sample. `deals.py show` prints the saved table.
- Rohlík: today's price of each product pick, live over MCP (`get_product_details`). Bananas are sold by the piece
  there, so that row compares the price per kg.
- The shops: akcniceny.cz deals through the old Frida scraper (run with `backend/.venv`'s Python). A deal counts only
  for a similar pack size and without a loyalty card. The two chains with the most deals that have a supermarket
  near `COLDEX_HOME` ("lat,lon", default náměstí Míru) make the columns, with OpenStreetMap distances. Only rows a
  shop has a price for are kept, so the card stays short.
- The bridge reruns the scrape in the background at start and every `DEALS_REFRESH_MIN` minutes (default 30). A
  failed refresh keeps the last file. Coldex never waits: `show_shops` only reads the file.
- `show_shops` now also returns the prices to the model, and its description says to call it for price questions.
  Tested by voice in Chromium with a synthetic mic: "how much are eggs today?" gave the C3 card and "64.9 at
  Rohlík, 29.9 on sale at Albert".
- For part 3: none of the demo items is on sale at Rohlík today, so the real data gives no sale tag. Rohlík's
  banana price moved from 9.68 to 9.06 Kč during the day, so products.md prices drift.
