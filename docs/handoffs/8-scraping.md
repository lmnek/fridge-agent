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
