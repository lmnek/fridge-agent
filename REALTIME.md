# Fridge Agent, Realtime version (`bridge/` + `app/`)

One OpenAI Realtime session is the whole brain. It hears the kitchen, sees camera photos and calls a
handful of tools. There is no agent framework, no vision pipeline and no database. It lives next to Frida (`backend/` + `frontend/`) and shares nothing with it.

## Run

```bash
cp bridge/.env.example bridge/.env        # put your OPENAI_API_KEY in it
cd bridge && uv run uvicorn main:app --port 8100
cd app && npm install && npm run dev      # http://localhost:5174
```

Every key and credential, with where to get it, is in [SETUP.md](SETUP.md).

Tap the light to wake the fridge (the browser asks for the microphone). Press `L` or click the camera
thumbnail to make it look inside. `POST /snapshot` on the bridge does the same from a script.

## How it works

- `bridge/main.py` (FastAPI, one file)
  - keeps the fridge in `data/state.json`
  - `GET /realtime/token` mints a Realtime session with the instructions, tools, household memory and the Rohlík MCP server
  - `GET /camera/{n}.jpg` proxies a Reolink snapshot
  - polls the hub's motion state and asks the app to look once the door settles
  - `GET /events` is an SSE stream for the app
- `app/src/realtime.ts` holds the WebRTC session. It runs function calls against the bridge and sends
  camera frames as images. Rohlík MCP calls that only read or fill the cart are approved
  automatically, every other call waits for a tap.
- `app/src/camera.ts` grabs frames from the hub or the webcam and shrinks them to fit the data channel.
- `app/src/Orb.tsx` is the fridge light.

Tools the model has: `get_inventory`, `update_inventory`, `remember`, `show_recipe`, plus either the
real Rohlík MCP or a fake cart (`add_to_cart`, `view_cart`, `place_order`).

Memory is markdown in `bridge/memory/`: `instructions.md` (the prompt, including how to narrate the
order), `household.md` (people, diets, brands, usual stock, weekly basics, shops) and `products.md`
(Rohlík product picks). All three are read fresh when a session starts, so edits need no restart.
`remember` appends dated lines to `data/notes.md`, and `get_household` returns everything fresh, so a
session that started before the craving still sees it. Delete `data/` to reset a rehearsal.

## Real and fake

| Piece | Real when | Fake, marked `HACK(demo)` |
|---|---|---|
| Brain | `OPENAI_API_KEY` is set | none, the app shows the error |
| Camera | `REOLINK_HOST` and `REOLINK_PASSWORD` are set | laptop webcam |
| Rohlík | `ROHLIK_TOKEN` is set | in-memory cart, the tap "places" the order |
| Fridge contents | cameras and the agent | a few seeded items on first start |

Ordering never happens without a human. The fake cart only orders when someone taps Place order. With
the real Rohlík MCP, every non-read call has `require_approval: "always"` and shows an Allow card.

Rohlík token: run `npx @modelcontextprotocol/inspector`, use its Quick OAuth Flow against
`https://mcp.rohlik.cz/mcp` and copy the access token into `ROHLIK_TOKEN`.

## Tests

```bash
cd bridge && uv run pytest -q
cd app && npm run build
```

## Not verified yet

- A live session with a real key. The code follows the current OpenAI docs and the event handling
  is tested with hand-written events, but it has not talked to OpenAI yet.
- Image input on `gpt-realtime-2.1`. The docs confirm it for `gpt-realtime-2` and `gpt-realtime`. If
  photos get rejected, set `REALTIME_MODEL` in `bridge/.env`.
- The Rohlík MCP tool names and the approval flow inside Realtime.
- Echo. Laptop speakers into an open mic can make the fridge interrupt itself. Rehearse with a
  separate speaker or headphones.
