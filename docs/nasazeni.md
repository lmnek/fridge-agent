# Nasazení

Frida je jeden proces (FastAPI, servíruje i sestavený frontend), SQLite databáze a volitelně go2rtc pro živý obraz. Žádná část neběží na AWS a nic se k AWS nepřipojuje. Venku jsou jen API, která si zapneš sám nebo sama (Anthropic, Twilio, Rohlík, OpenStreetMap).

## Kde to provozovat

Kamery Reolink jsou dostupné jen v domácí síti, proto je nejpraktičtější provoz doma:

- **Mini PC nebo starý notebook doma** (doporučeno). Má přístup ke kamerám v LAN, lokální vision transformery na něm poběží. Apple Silicon zvládne lokální modely přes MPS.
- **Raspberry Pi 5 (8 GB)**. Backend, go2rtc i Claude vision bez problémů. Lokální vision transformery jsou na něm pomalé (sekundy až desítky sekund na snímek), použij spíš `FRIDA_VISION_PROVIDER=claude`.
- **Server mimo domov** (např. Hetzner v EU) jen pokud vyřešíš přístup ke kamerám (VPN typu WireGuard nebo Tailscale do domácí sítě). Kamery by se jinak musely vystavit do internetu, a to nedělej.

## Docker Compose

```bash
cp .env.example .env                                          # vyplň, co chceš zapnout
docker compose -f infra/docker-compose.yml up -d --build
open http://localhost:8000
```

- `frida`: backend i frontend na portu 8000, data ve svazku `frida-data`.
- `go2rtc`: živý obraz na portu 1984 (WebRTC na 8555). Na Linuxu je pro WebRTC v LAN nejspolehlivější `network_mode: host`.
- `tunnel` (profil `tunnel`): Cloudflare Tunnel pro veřejnou HTTPS adresu.

## Veřejná adresa pro Twilio (Cloudflare Tunnel)

Twilio potřebuje na backend volat přes HTTPS a otevírat WebSocket (`wss://.../voice/relay`). Bez otevírání portů na routeru:

1. V Cloudflare Zero Trust vytvoř tunel a zkopíruj jeho token do `CLOUDFLARE_TUNNEL_TOKEN`.
2. V tunelu přidej veřejný hostname (např. `frida.tvoje-domena.cz`) mířící na `http://frida:8000`.
3. Nastav `FRIDA_PUBLIC_BASE_URL=https://frida.tvoje-domena.cz`.
4. Spusť `docker compose -f infra/docker-compose.yml --profile tunnel up -d`.

**Zabezpečení:** API Fridy nemá vlastní přihlašování (je určené pro domácí síť). Když ho vystavíš přes tunel, zapni v Cloudflare Access ochranu pro všechno kromě cest `/voice/*`, které musí zůstat dostupné pro Twilio (ty chrání podpis `X-Twilio-Signature`).

## Bez Dockeru

```bash
cd frontend && npm ci && npm run build && cd ..
cd backend && uv sync --extra reolink && uv run frida serve --host 0.0.0.0
```

Pozor: `uv sync` bez `--extra` odinstaluje volitelné balíčky (Reolink, lokální vision).

## Zálohy

Všechno je v jednom souboru `data/frida.db` (SQLite ve WAL režimu) a ve složce `data/snapshots/` (snímky z kamer, drží se posledních 300 na kameru). Zálohuj `data/`.
