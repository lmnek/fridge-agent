# Akce, obchody, rozvoz a recepty

Stav rešerše: 13. 11. 2026, ověřováno anonymními požadavky z české IP. Hledání akcí ve Fridě je napsané od nuly, žádný kód z jiných projektů.

## Zdroje akcí

| Web | Hledání | Stránka nabídky | Strukturovaná data | robots.txt |
|---|---|---|---|---|
| **akcniceny.cz** | `/hledej?s=maslo` | `/akce/{slug}/` | mikrodata Product → AggregateOffer → Offer (`seller.name`, `price`, `priceValidUntil`) | volné, `Crawl-delay: 1` ([robots](https://www.akcniceny.cz/robots.txt)) |
| **kupi.cz** | `/hledej?f=maslo` | `/sleva/{slug}` | JSON-LD na `/sleva/`, hledání jen HTML | blokuje `/get-akce`, stránkování hledání a **`User-agent: AI` → `Disallow: /`** ([robots](https://www.kupi.cz/robots.txt)) |
| letakomat.cz | `/hledat/?q=` | letáky | jen BreadcrumbList | blokuje `/api/`, `*/offers/*`, `*/detail/*` |
| iletaky.cz | `/hledej?q=` | prohlížeč letáků | žádná | volné, `Request-rate: 40/1m` |

**Co Frida používá:**

- **akcniceny.cz** (výchozí). Hledání → stránky nabídek → mikrodata. Původní cena se dopočítá ze slevy v %, „Zbývá X dní“ a podmínky („cena za 1 ks od 3 ks“) se čtou z textu. Mezi požadavky je pauza aspoň 1 s podle `Crawl-delay`.
- **kupi.cz** (vypnuto, zapíná se `FRIDA_DEALS_SOURCES='["akcniceny","kupi"]'`). Výsledky hledání mají nejbohatší data: cena, běžná cena, sleva, **cena za jednotku**, platnost (bez roku) a „Platí pro členy klubu“. Frida čte jen první stránku hledání, nestránkuje a nevolá `/get-akce`. Pozor na pravidlo `User-agent: AI` v robots.txt. Frida se představuje vlastním User-Agentem, ale rozhodnutí, jestli kupi.cz zapnout, je na tobě.
- **Rohlík** (`get_discounted_items` přes MCP), když je připojený.

Letáky se liší podle regionu a formátu prodejny („Albert Supermarket Praha 4“). Frida proto u každé akce ukazuje, v jakém formátu platí, pokud to zdroj uvádí.

Všechno jde přes `FRIDA_DEALS_LIVE=true`. Bez toho běží demo akce označené `source="demo"`.

## Obchody v okolí (OpenStreetMap)

```text
POST https://overpass-api.de/api/interpreter
data=[out:json][timeout:25];
nwr["shop"~"^(supermarket|convenience)$"](around:1500,50.0755,14.4378);
out center tags;
```

Tenhle dotaz vrátil 38 obchodů do 1,5 km od náměstí Míru. 15 z nich nemělo značku `brand`, proto Frida pozná řetězec postupně podle `brand:wikidata`, `brand` a nakonec podle názvu.

| Řetězec | Wikidata |
|---|---|
| Albert | Q9144241 |
| Billa | Q42969493 |
| Lidl | Q151954 |
| Kaufland | Q685967 |
| Penny | Q284688 |
| Tesco / Expres / Extra | Q487494 / Q98456772 / Q25172225 |
| Globus | Q457503 |
| Coop | Q52851660 |
| Norma | Q450180 |
| Žabka | Q133445159 |

Pravidla Overpass: do 10 000 dotazů a 1 GB denně je to v pořádku, cachovat, neposílat paralelně, po 429 počkat 30 s. Frida cachuje obchody na 24 hodin.

**Nominatim** (adresa z GPS): max. 1 požadavek za sekundu na celou aplikaci, User-Agent aplikace, povinné cachování, žádné našeptávání adres, atribuce ODbL. Frida volá Nominatim jen ze serveru a jen při změně polohy.

## Online nákup kromě Rohlíku

- **Košík.cz:** veřejné API nemá.
- **Tesco Online:** veřejné API nemá, stránky produktů vrací 403.
- **Albert a Billa:** vlastní e-shopy v Praze skončily, prodávají přes Wolt a Foodoru.
- **Wolt** má ceny konkrétních prodejen včetně EAN, ale viz podmínky níže.

## Rozvoz jídla (když máš chuť)

Wolt i Foodora mají neoficiální JSON endpointy (výpis podniků podle polohy funguje), ale **podmínky Wolt pro ČR (§13.6) výslovně zakazují automatický sběr dat a boty**. Oficiální API je jen pro partnery.

**Rozhodnutí:** Frida nescrapuje Wolt ani Foodoru. Na otázku „mám chuť na pizzu“ nabídne:
1. co jde uvařit hned z lednice,
2. co jde uvařit s dokoupením pár věcí (s akcemi nebo košíkem v Rohlíku),
3. **odkazy do Woltu a Foodory** na vyhledávání dané kuchyně u tebe (deep link, žádné stahování dat).

Rozhraní `DeliveryProvider` je připravené, takže kdyby se podařilo získat partnerský přístup, doplní se jen adaptér.

## Recepty

- **Frida si recepty skládá sama** pomocí Claude z toho, co je v lednici, s přednostním použitím věcí, kterým končí trvanlivost. Bez klíče použije malou vestavěnou sbírku vlastních receptů.
- **Rohlík MCP** má `search_recipes_by_vector_similarity` a `get_recipe_detail`. Když je Rohlík připojený, agent je může použít.
- toprecepty.cz, recepty.cz a apetitonline.cz mají Recipe JSON-LD, ale texty jsou chráněné autorským právem. Hodí se jen indexovat suroviny a odkazovat ven, ne přebírat postupy.
- TheMealDB a Spoonacular jsou anglicky a s omezeními (vývojový klíč, malé free limity), proto je Frida nepoužívá.

## Čárové kódy a trvanlivost

- **Open Food Facts:** `GET https://world.openfoodfacts.org/api/v2/product/{EAN}.json?fields=code,product_name,brands,quantity,categories_tags`. User-Agent ve tvaru `AppName/Version (kontakt)`, limit 15 čtení a 10 hledání za minutu na IP, licence ODbL. Pokrytí českých výrobků je děravé. Frida výsledky cachuje a kontakt v User-Agentu nastavíš v `FRIDA_HTTP_USER_AGENT` (výchozí je obecný, bez osobních údajů).
- **USDA FoodKeeper** (CC0, 661 položek s dobou skladování v lednici a mrazáku): oficiální soubor vrací 403, funguje [archivovaná kopie](https://web.archive.org/web/20250702182320id_/https://www.fsis.usda.gov/shared/data/EN/foodkeeper.json). Frida má vlastní orientační trvanlivosti v `frida/food/catalog.py`. Import FoodKeeperu je možné rozšíření.

## Test samostatně

```bash
cd backend
FRIDA_DEALS_LIVE=true uv run frida deals "máslo"
FRIDA_GEO_LIVE=true uv run frida stores --lat 50.0755 --lon 14.4378
```

## Neověřeno

- Podmínky kupi.cz a akcniceny.cz ke scrapování (stránku s podmínkami se nepodařilo najít).
- Endpointy a podmínky Bolt Food a menu Foodory.
- Jestli je Albert na Foodoře v Praze.
