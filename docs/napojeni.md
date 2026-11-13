# Napojení na skutečné služby

Frida běží bez jakékoli konfigurace v demo režimu. Každou integraci zapneš samostatně proměnnými v `.env` (vzor je v `.env.example`) a každou jde otestovat samostatně příkazem z terminálu, ještě než spustíš celou aplikaci. V aplikaci uvidíš stav všech integrací v Nastavení (`live` nebo `demo`) a také přes `GET /api/status`.

Všechny příkazy níž se spouští ze složky `backend/`.

| Integrace | Co zapne | Proměnné | Kód | Test |
|---|---|---|---|---|
| Claude | chat a hlas Fridy, rozpoznávání obrazu, recepty | `ANTHROPIC_API_KEY` | `frida/agent/`, `frida/vision/claude.py` | `uv run frida chat "co mám v lednici?"` |
| Kamery Reolink | skutečné snímky a otevírání dveří | `FRIDA_REOLINK_*` | `frida/camera/reolink.py` | `uv run frida camera-info` |
| Živý obraz | WebRTC náhled z kamer | `REOLINK_*`, `FRIDA_GO2RTC_*` | `infra/go2rtc.yaml` | `http://localhost:1984` |
| Lokální vision | rozpoznávání doma bez cloudu | `FRIDA_VISION_PROVIDER` | `frida/vision/local_vit.py` | `uv run pytest tests/test_local_vit.py` |
| Rohlík | hledání a plnění košíku | `FRIDA_ROHLIK_*` | `frida/grocery/rohlik_mcp.py` | `uv run frida rohlik-tools` |
| Twilio | hovory, SMS, WhatsApp | `FRIDA_TWILIO_*`, `FRIDA_USER_PHONE` | `frida/voice/` | `uv run frida test-call` |
| Akce | skutečné akční ceny | `FRIDA_DEALS_LIVE` | `frida/deals/` | `uv run frida deals "máslo"` |
| Obchody a adresa | OpenStreetMap a Nominatim | `FRIDA_GEO_LIVE` | `frida/geo/service.py` | `uv run frida stores` |
| Čárové kódy | Open Food Facts | `FRIDA_BARCODE_LIVE` | `frida/food/products.py` | `curl localhost:8000/api/barcode/<EAN>` |
| Rozvoz jídla | jen odkazy do Woltu a foodory | `FRIDA_DELIVERY_LIVE` | `frida/food/delivery.py` | v aplikaci „Na co máš chuť?“ |

## 1. Claude (mozek Fridy)

1. Vytvoř klíč na [console.anthropic.com](https://console.anthropic.com). Volá se přímo Anthropic API, ne přes AWS.
2. Do `.env` dej `ANTHROPIC_API_KEY=...`.
3. Test: `uv run frida chat "co se mi kazí?"`. Měla by přijít odpověď a pod ní seznam nástrojů, které agent použil.

Nastavení:

- Model je `claude-opus-5-5` (`FRIDA_AGENT_MODEL`). U tohoto modelu je thinking vždy zapnuté a hloubku řídí `effort`: chat `medium`, hlas `low` (rychlejší odpověď do telefonu), rozpoznávání obrazu `high`.
- **Server-side fallback je zapnutý** (`FRIDA_AGENT_FALLBACKS=true`, beta `server-side-fallback-2026-07-01`). Když model požadavek odmítne kvůli bezpečnostním pravidlům, API ho samo zkusí na záložním modelu. Vypneš ho `FRIDA_AGENT_FALLBACKS=false`.
- S klíčem se Claude automaticky použije i na rozpoznávání snímků ze skutečných kamer. Na simulované lednici zůstává `mock` (zná scénu), Claude na ní zapneš `FRIDA_VISION_PROVIDER=claude`.
- Náklady: každý snímek po otevření dveří, na kterém se něco změnilo, je jedno volání s obrázkem. Snímky beze změny a za tmy se neposílají. Levnější varianta je kaskáda s lokálními modely (bod 4).

## 2. Kamery Reolink (Home Hub + 2× Argus B310)

Podrobnosti a omezení bateriových kamer jsou v [integrace/reolink-kamera.md](integrace/reolink-kamera.md). Zkráceně:

1. Aktualizuj firmware hubu i kamer v aplikaci Reolink.
2. Hub přidej v aplikaci jako lokální zařízení a v jeho nastavení sítě zapni HTTP/HTTPS a RTSP.
3. Do `.env` dej `FRIDA_REOLINK_HOST` (IP hubu v LAN), `FRIDA_REOLINK_USERNAME` a `FRIDA_REOLINK_PASSWORD`. Kanál 0 je první kamera na hubu, kanál 1 druhá (`FRIDA_REOLINK_CHANNELS`).
4. Test: `uv run frida camera-info` (baterie, signál, online) a `uv run frida snapshot --channel 0 --out police.jpg`.
5. Otevři lednici. V aplikaci by se měly rozsvítit dveře a po pár sekundách přijít snímek s rozpoznanými věcmi.

Když PIR kamery otevření dveří spolehlivě nepozná, přidej dveřní kontakt (např. Zigbee přes Home Assistant) a z automatizace volej:

```bash
curl -X POST http://FRIDA:8000/api/camera/trigger \
  -H 'content-type: application/json' \
  -d '{"camera_id": "cam0", "kind": "door_open"}'
```

a při zavření totéž s `"kind": "door_closed"`.

## 3. Živý obraz (go2rtc)

1. Do `.env` doplň `REOLINK_HOST`, `REOLINK_USER`, `REOLINK_PASSWORD` (čte je go2rtc).
2. Spusť go2rtc (v `infra/docker-compose.yml` je připravený) a otevři `http://localhost:1984`, stream `fridge_cam0`.
3. Když prohlížeč přistupuje odjinud než backend, nastav `FRIDA_GO2RTC_PUBLIC_URL`.

Bateriové kamery drží náhled maximálně 5 minut. Aplikace náhled ukončí po `FRIDA_LIVE_VIEW_MAX_SECONDS` (240 s).

## 4. Lokální rozpoznávání (vision transformery)

Návod je v [integrace/lokalni-vision.md](integrace/lokalni-vision.md). Zkráceně `uv sync --extra vision-local --extra reolink` a `FRIDA_VISION_PROVIDER=cascade`. OWLv2 najde věci, SigLIP 2 je pojmenuje, Claude se zavolá jen u nejistých nebo nových věcí.

## 5. Rohlík (MCP)

Návod je v [integrace/rohlik-mcp.md](integrace/rohlik-mcp.md). Frida podporuje tři způsoby přihlášení:

- oficiální server `https://mcp.rohlik.cz/mcp` s tokenem (`FRIDA_ROHLIK_MCP_URL`, `FRIDA_ROHLIK_BEARER_TOKEN`),
- oficiální server se starším přihlášením e-mailem a heslem (`FRIDA_ROHLIK_EMAIL`, `FRIDA_ROHLIK_PASSWORD`),
- komunitní lokální server (`FRIDA_ROHLIK_MCP_COMMAND="npx -y @tomaspavlin/rohlik-mcp"`, potřebuje Node.js).

Test: `uv run frida rohlik-tools` vypíše nástroje serveru a označí, které Frida smí použít. `uv run frida rohlik-search "mléko"` zkusí hledání.

**Frida nikdy neobjedná ani nezaplatí.** Umí jen naplnit košík a dát odkaz, kde objednávku dokončíš sám nebo sama v Rohlíku. Nástroje na rušení objednávek a reklamace jsou zablokované v kódu.

## 6. Telefon (Twilio)

Návod je v [integrace/hlas-twilio.md](integrace/hlas-twilio.md). Zkráceně:

1. Účet Twilio, zakoupené číslo s hlasem a v Geo Permissions povolená Česká republika.
2. Veřejná HTTPS adresa backendu (`FRIDA_PUBLIC_BASE_URL`), doma nejsnáz přes Cloudflare Tunnel (viz [nasazeni.md](nasazeni.md)).
3. Do `.env` `FRIDA_TWILIO_ACCOUNT_SID`, `FRIDA_TWILIO_AUTH_TOKEN`, `FRIDA_TWILIO_FROM_NUMBER`, `FRIDA_USER_PHONE`.
4. Nejdřív bez telefonu: `uv run frida relay-sim` (hlasový agent v terminálu), pak `uv run frida test-call --reason "Zkušební hovor"`.

Pojistky: volat jde jen na čísla v allowlistu (`FRIDA_ALLOWED_CALL_NUMBERS`, prázdný = jen tvoje číslo), limit hovorů za hodinu a za den, tiché hodiny (22 až 7), maximální délka hovoru a kontrola podpisu Twilia u všech webhooků.

## 7. Akce, obchody, čárové kódy

- `FRIDA_DEALS_LIVE=true` zapne čtení akcí z akcniceny.cz (výchozí). kupi.cz zapneš `FRIDA_DEALS_SOURCES='["akcniceny","kupi"]'`, ale přečti si nejdřív poznámku o jejich robots.txt v [integrace/akce-a-obchody.md](integrace/akce-a-obchody.md). Požadavky jsou zpomalené na jeden za 1,1 s a výsledky se cachují 3 hodiny.
- `FRIDA_GEO_LIVE=true` zapne obchody z OpenStreetMap (Overpass, cache 24 h) a adresu z GPS přes Nominatim.
- `FRIDA_BARCODE_LIVE=true` zapne dohledání čárových kódů v Open Food Facts.
- Všechny tyhle služby dostávají jen obecný User-Agent aplikace (`FRIDA_HTTP_USER_AGENT`), žádné osobní údaje.

## 8. Rozvoz jídla

Wolt i foodora (dříve Dáme jídlo) zakazují automatický sběr dat, takže Frida nabízí jen odkazy do jejich aplikací. `FRIDA_DELIVERY_LIVE=true` vypne smyšlené demo podniky. Při partnerském přístupu stačí dopsat třídu s metodou `venues()` podle `DeliveryProvider` v `frida/food/delivery.py`.

## Kontrola po napojení

```bash
uv run frida status          # live/demo pro každou integraci
uv run pytest -q             # testy (běží bez sítě a bez klíčů)
```
