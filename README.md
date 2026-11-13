# Frida, chytrá lednice

Frida hlídá, co je v lednici, a stará se, aby nic nedošlo a nic se nevyhodilo. Dvě malé kamery Reolink v lednici poznají, co přibylo a co ubylo. Agent nad Claude najde nejlevnější akce v obchodech kolem tebe v Praze, naplánuje nákup, naplní košík v Rohlíku, vymyslí, co uvařit z věcí, které je potřeba spotřebovat, a když něco dojde, napíše nebo zavolá.

Celá aplikace běží hned po spuštění v **demo režimu** (simulovaná lednice, ceny, košík i hovory). Skutečné služby se připojují postupně a každou jde otestovat zvlášť, viz [docs/napojeni.md](docs/napojeni.md).

## Co umí

- **Kamery v lednici:** snímek při otevření dveří, rozpoznání potravin (Claude, lokální vision transformery nebo kaskáda obou), párování s inventářem, hlídání otevřených dveří, živý obraz na vyžádání.
- **Inventář:** množství, hladina v lahvích, trvanlivost (z obalu, z mobilu nebo odhadem), stav ok, dochází, došlo, končí, prošlé. Predikce, kdy co dojde, podle tvé spotřeby. Kolik peněz se vyhodilo.
- **Skenovat datum:** vyfoť mobilem etiketu nebo čárový kód a Frida si datum spotřeby zapíše.
- **Akce v okolí:** akční ceny z akcniceny.cz (volitelně kupi.cz), nejbližší pobočky z OpenStreetMap, hodnocení ceny podle historie („kup teď“, „počkej“).
- **Plán nákupu:** nejlevnější rozdělení mezi obchody včetně ceny cesty, všechno v jednom obchodě, nebo dovoz z Rohlíku.
- **Rohlík:** hledání a plnění košíku přes Rohlík MCP. Objednávku vždy potvrzuješ ty v Rohlíku.
- **Na co máš chuť:** co uvařit hned, co s dokoupením pár věcí, nebo odkaz na rozvoz (Wolt, foodora).
- **Hlas a telefon:** mluvení s Fridou v prohlížeči (cs-CZ), hovor na mobil přes Twilio, když něco dojde nebo zůstanou otevřené dveře. Pojistky proti nechtěným hovorům.
- **Přehledy:** spotřeba, vyhozené jídlo po měsících, otevírání lednice během dne, ušetřeno na akcích.

## Rychlý start

Potřebuješ [uv](https://docs.astral.sh/uv/) a Node.js 22 nebo novější.

```bash
# backend (API na http://127.0.0.1:8000)
cd backend
uv sync --extra reolink
uv run frida serve

# frontend (v druhém terminálu, http://localhost:5173)
cd frontend
npm install
npm run dev
```

Otevři http://localhost:5173. V demo režimu zkus v panelu kamery „vzít“ mléko z lednice a sleduj, co Frida udělá. Nebo se jí zeptej tlačítkem dole uprostřed.

Plnou konverzaci zapneš klíčem `ANTHROPIC_API_KEY` v `.env` (vzor v [.env.example](.env.example)). Bez klíče odpovídá jednoduchý pravidlový agent nad stejnými nástroji.

Docker (backend, frontend a go2rtc):

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d --build    # http://localhost:8000
```

## Struktura

```text
backend/            FastAPI, agent, integrace (Python 3.13, uv)
  frida/agent/      mozek Fridy: smyčka nad Claude, nástroje, demo pravidla
  frida/camera/     Reolink, simulovaná lednice, správa snímků a dveří
  frida/vision/     rozpoznávání: Claude, lokální ViT (OWLv2, SigLIP 2, Florence-2), kaskáda
  frida/deals/      akce (akcniceny.cz, kupi.cz), historie cen, plán nákupu
  frida/grocery/    Rohlík MCP a demo košík
  frida/food/       katalog potravin, recepty, rozvoz, čárové kódy
  frida/voice/      Twilio: hovory, ConversationRelay, pojistky
  frida/api/        REST a WebSocket
  tests/            testy (bez sítě a bez klíčů)
frontend/           React + Vite + Tailwind
infra/              Docker Compose, go2rtc, Cloudflare Tunnel
docs/               napojení, nasazení, rozhodnutí, rešerše integrací
```

## Dokumentace

- [Napojení na skutečné služby](docs/napojeni.md) (proměnné, testy z terminálu)
- [Nasazení](docs/nasazeni.md) (doma, Docker, Cloudflare Tunnel, bez AWS)
- [Architektura a rozhodnutí](docs/rozhodnuti.md)
- Rešerše integrací: [Reolink](docs/integrace/reolink-kamera.md), [lokální vision](docs/integrace/lokalni-vision.md), [Rohlík MCP](docs/integrace/rohlik-mcp.md), [Twilio](docs/integrace/hlas-twilio.md), [akce a obchody](docs/integrace/akce-a-obchody.md)

## Testy

```bash
cd backend
uv run pytest -q          # inventář přes kameru, agent, API, WebSocket, hovory, scrapery, Rohlík MCP a Reolink proti mockům
uv run ruff check frida tests
cd ../frontend && npm run build
```

## Bezpečnost a soukromí

- Žádná část neběží na AWS a nic se k AWS nepřipojuje. Claude se volá přímo přes Anthropic API.
- Frida nikdy neobjedná ani nezaplatí. Plní jen košík.
- Hovory jdou jen na čísla v allowlistu, s limity, tichými hodinami a maximální délkou.
- Klíče zůstávají na serveru, do prohlížeče nejde nic.
- Veřejným službám (OpenStreetMap, Open Food Facts, weby s akcemi) se posílá jen obecný User-Agent aplikace.
- API nemá vlastní přihlašování, je určené pro domácí síť. Při vystavení do internetu použij Cloudflare Access (viz [nasazení](docs/nasazeni.md)).
