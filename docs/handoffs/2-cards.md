# 2. Side panel cards

Beats B, C1–C4, D/E, F and G. These are the cards that show what Coldex is doing, while it does it.

## Goal

Each card shows one step of the agent's work. It appears when the matching event arrives on the bus, so the
panel stays truthful and adds no latency. The cards share one visual language and animate with `motion`.

## Cards, in priority order (DEMO.md)

| Card | Shows | Driven by |
|---|---|---|
| **C4 cart** | rows with image, quantity, price and a why tag (*ran out*, *for carbonara*, *gluten-free · Anna*, *lactose-free*, *weekly*, *−20 % sale*). The total counts up toward the 749 Kč bar | `cart` event (`show_cart`) |
| **B analysis** | the captured frame, an "analysing" state, detection boxes, then "milk: out, eggs: out". Then a craving card drops in | `vision` events, then `learned` with category `craving` |
| **C3 shops** | a map with a radar sweep: Lidl 400 m against Rohlík within the hour, and Rohlík wins | `tool` `show_shops` (part 3 adds it) |
| **D/E mini browser** | a browser frame playing the sped-up recording of the real Rohlík checkout, then "courier on the way" | `stage` event (hotkey). The recording comes from part 5 |
| **F call card** | the courier's caller ID, a call timer, and live subtitles for both sides | `call` events, `caption` from coldex and courier |
| **C1 fridge check** | the fridge contents, with the missing usual items highlighted (milk, eggs) | `tool` `get_inventory`, `inventory` |
| **C2 recipe** | carbonara split into ingredients, each marked have or missing | `tool` `show_recipe` |
| **G delivered** | a check mark | `stage` event (hotkey) |

## Done when

Every card works on fake events and switches over cleanly when the real events arrive. C4 looks great at
projector size. Nothing on the cards uses emoji, sparkles or gradients.

## Where

`app/src/stage/cards/` and assets in `app/public/demo/`. Part 1 owns the panel that switches between the cards.

## Parallelize

One subagent per card (B, C1+C2, C3, C4, D/E+G, F), all building against the same fake event list, then
one review pass for a consistent look. Start the C4 and B subagents first.

## Reuse (old Frida build, `frontend/src/features/`)

`cameras/CameraFrame.tsx` and `PipelineTrace.tsx` (detection boxes and the pipeline steps), `shopping/StoreRadar.tsx`,
`shopping/CartPanel.tsx`, `food/RecipeCard.tsx`, `call/CallLayer.tsx` and `chat/ToolChip.tsx`. `motion` is
installed in `frontend/`, so add it to `app/`.

## Fake mode

The fake event list is the fake mode. It also covers the hotkey fallbacks in DEMO.md.
