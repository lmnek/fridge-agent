# Setup: API keys and credentials

Context for whoever sets this repo up (Codex or a person). It lists every credential, where each one
goes, how to get it, and how to check it works. It contains no secret values.

The repo holds two apps that share nothing:

- **Realtime version** in `bridge/` + `app/` (bridge on port 8100, app on 5174). One OpenAI Realtime
  session is the brain. Values go into `bridge/.env`. Most of this file is about it.
- **Frida** in `backend/` + `frontend/` (backend on 8000, frontend on 5173). Claude is the brain. Values
  go into `backend/.env` or the root `.env`. See the last section.

## Rules

- All values go into `bridge/.env`. Start from `bridge/.env.example`. The bridge also reads a `.env` in
  the repo root, but use `bridge/.env` only, so there is one place to look.
- `.env` and `*.env` are gitignored. Never commit them, never print key values in logs or chat, never
  put a key into `app/`. The browser only ever gets a short-lived Realtime key from the bridge.
- The bridge reads `.env` once at startup. Restart it after every change.
- Nothing may place a Rohlík order without a human tapping approve in the app. Don't loosen
  `require_approval` or the auto-approve list in `app/src/realtime.ts`.

## What is needed

| Variable | Required | What it is |
|---|---|---|
| `OPENAI_API_KEY` | yes | OpenAI API key. The Realtime model is the whole brain. |
| `REALTIME_MODEL` | no | Defaults to `gpt-realtime-2.1`. Use `gpt-realtime-2` if camera photos get rejected. |
| `REALTIME_VOICE` | no | Defaults to `marin`. |
| `ROHLIK_TOKEN` | no | OAuth access token for the official Rohlík MCP server. Without it, a fake in-memory cart is used. |
| `ROHLIK_MCP_URL` | no | Defaults to `https://mcp.rohlik.cz/mcp`. Keep it exactly like that, no trailing slash. |
| `REOLINK_HOST` | no | LAN IP of the Reolink Home Hub, for example `192.168.1.50`. Without it, the laptop webcam stands in. |
| `REOLINK_USER` | no | Defaults to `admin`. |
| `REOLINK_PASSWORD` | with `REOLINK_HOST` | The hub's local login password. |
| `REOLINK_CHANNELS` | no | Defaults to `0,1`, the two Argus B310 cameras on the hub. |
| `DEMO_SEED` | no | `1` (default) seeds a few fridge items on first start. |
| `DATA_DIR` | no | Defaults to `data/` in the repo root. Delete `data/state.json` with the bridge stopped to reset the fridge. |

Not needed for the Realtime version: `ANTHROPIC_API_KEY` (Frida only), `API_SERVER_KEY` and the
Telegram bot token (the dropped Hermes plan), `ELEVENLABS_API_KEY`, `APIFY_TOKEN`.

## How to get each one

### OPENAI_API_KEY

1. Sign in at https://platform.openai.com, open API keys and create a project key.
2. The project needs billing enabled and access to the Realtime models.
3. Put it into `bridge/.env` as `OPENAI_API_KEY=...`.

### ROHLIK_TOKEN

The official server uses OAuth: authorization server `https://identity.rohlik.cz`, PKCE, dynamic client
registration, scopes `openid email roles`. The quickest way to get a token by hand:

1. Run `npx @modelcontextprotocol/inspector`.
2. Transport: Streamable HTTP. URL: `https://mcp.rohlik.cz/mcp`.
3. Open the auth settings, run the Quick OAuth Flow and log in with the household's Rohlík account.
4. Copy the access token into `bridge/.env` as `ROHLIK_TOKEN=...`.

Unknown so far: how long the token lives and whether a refresh token is issued. If OpenAI rejects the
MCP setup, the bridge falls back to the fake cart and the app shows "Rohlík MCP rejected". We have a Rohlík pro account, so there's no minimum order.

### Reolink hub

1. In the Reolink app the hub must be added as a Local device, not an Account device. Otherwise local
   login fails.
2. Turn on HTTPS on the hub: device, More Features, Advanced Network Settings, Server Settings.
3. The B310 cameras need current firmware before the hub accepts them.
4. Set `REOLINK_HOST`, `REOLINK_USER` and `REOLINK_PASSWORD`. The hub, the cameras and the laptop must
   be on the same network. Venue Wi-Fi often isolates clients, so bring a travel router.

## Run and verify

```bash
cd bridge && uv run uvicorn main:app --port 8100      # terminal 1
cd app && npm install && npm run dev                  # terminal 2, http://localhost:5174
```

Port 5173 may be taken by another project, which is why the app uses 5174.

Checks, in this order:

```bash
curl -s localhost:8100/config
# {"model": ..., "openai": true, "rohlik": true|false, "cameras": [0, 1] or []}

curl -s localhost:8100/realtime/token
# {"value": "ek_...", "model": ..., "rohlik": true|false}
# This makes OpenAI validate the whole session (tools, voice, Rohlík MCP).
# A 502 contains OpenAI's error message. A 503 means OPENAI_API_KEY is missing.

curl -s -o /tmp/fridge.jpg -w "%{http_code} %{content_type}\n" localhost:8100/camera/0.jpg
# 200 image/jpeg with a hub, 404 without one (the app then uses the webcam)

cd bridge && uv run pytest -q
```

Then open http://localhost:5174, tap the light, allow the microphone and say something. Press `L` to
make the fridge look inside. If the token check passes but the voice never answers, check the browser
console for the `/v1/realtime/calls` response.

## Frida (`backend/` + `frontend/`)

Frida starts in demo mode with no keys at all, and each integration goes live on its own. All variables,
with comments, are in `.env.example` in the repo root. Copy it to `.env` (or `backend/.env`). How to test
each integration from the terminal is in `docs/napojeni.md` (Czech).

| Variable | What it turns on |
|---|---|
| `ANTHROPIC_API_KEY` | The Claude agent and Claude vision. Without it, a rule-based agent answers. |
| `FRIDA_REOLINK_HOST`, `FRIDA_REOLINK_USERNAME`, `FRIDA_REOLINK_PASSWORD` | The real cameras. Same hub and same steps as above. |
| `FRIDA_ROHLIK_MCP_URL` + `FRIDA_ROHLIK_BEARER_TOKEN` | The real Rohlík cart. Same token as `ROHLIK_TOKEN` above, with the URL `https://mcp.rohlik.cz/mcp`. |
| `FRIDA_TWILIO_ACCOUNT_SID`, `FRIDA_TWILIO_AUTH_TOKEN`, `FRIDA_TWILIO_FROM_NUMBER` | Real calls and SMS. From the Twilio console, the number must be able to call Czech numbers. |
| `FRIDA_USER_PHONE`, `FRIDA_ALLOWED_CALL_NUMBERS` | Who Frida calls. Calls only go to numbers in the allowlist, in E.164 format like `+420...`. |
| `FRIDA_PUBLIC_BASE_URL` | A public HTTPS address of the backend (for example a Cloudflare Tunnel). Twilio needs it for call webhooks. |
| `FRIDA_DEALS_LIVE`, `FRIDA_GEO_LIVE`, `FRIDA_BARCODE_LIVE` | `true` switches deals, nearby stores and barcode lookup from demo data to the real public sources. No keys needed. |

Run it with `cd backend && uv run frida serve` and `cd frontend && npm run dev`. Check with
`curl -s localhost:8000/api/status`, where `integrations` shows which parts are live and which are demo.
