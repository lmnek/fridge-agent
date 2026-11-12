# Rohlík MCP

Stav rešerše: 13. 11. 2026. Zdroje jsou uvedené u každého bodu. Co nešlo ověřit, je výslovně označené.

## Oficiální server Rohlíku

- **Adresa:** `https://mcp.rohlik.cz/mcp`, přesně takhle, bez lomítka na konci. Zdroje: [rohlik-mcp-server](https://www.rohlik.cz/stranka/rohlik-mcp-server), [mcp-server](https://www.rohlik.cz/stranka/mcp-server), [mcp-docs](https://www.rohlik.cz/en-CZ/mcp-docs).
- **Transport:** Streamable HTTP. Odpověď na `initialize` vrací hlavičku `mcp-session-id`. Rohlík pro Claude Code uvádí `claude mcp add --transport http rohlik-mcp https://mcp.rohlik.cz/mcp`. Soubor [llms-full.txt](https://www.rohlik.cz/llms-full.txt) sice zmiňuje SSE, ale živý server se chová jako Streamable HTTP.
- **Přihlášení:** OAuth bearer token. Bez tokenu server vrátí 401 a odkáže na `/.well-known/oauth-protected-resource/mcp`.
  - autorizační server `https://identity.rohlik.cz`
  - scopes `openid email roles`
  - PKCE S256
  - dynamická registrace klienta na `/connect/register`
  - veřejný klient (token endpoint auth method `none`)
- **Starší způsob přihlášení:** hlavičky `rhl-email` a `rhl-pass` přes `npx mcp-remote https://mcp.rohlik.cz/mcp --header "rhl-email: …" --header "rhl-pass: …"`. Neověřeno, jestli pořád funguje.
- **Další země:** `mcp.knuspr.de`, `mcp.gurkerl.at`, `mcp.kifli.hu`, `mcp.sezamo.ro` odpovídají stejně (401), dokumentace je ale jen pro rohlik.cz.

## Nástroje (tools)

Rohlík zveřejňuje jen kategorie schopností. Názvy níže pocházejí ze snímku adresáře [MCPBundles](https://www.mcpbundles.com/api/directory/v1/servers/rohlik-mcp-9a0d47fdbb) z 3. 11. 2026 (59 nástrojů). **Po přihlášení je vždy ověř přes `tools/list`**, Frida to dělá sama při startu (`frida rohlik-tools`).

| Potřeba | Oficiální server | Komunitní server |
|---|---|---|
| Hledání | `batch_search_products(queries[])`, až 4 dotazy, každý s `keyword`, `filters`, `sort_type` | `search_products(product_name, limit?, favourite_only?)` |
| Detail produktu | `get_product_details(product_ids)`, `get_products_composition_batch(product_ids)` | není |
| Košík | `get_cart`, `add_items_to_cart(items[{productId, quantity}])`, `update_cart_item(product_id, quantity)`, `remove_cart_item(product_id)`, `clear_cart` | `get_cart_content`, `add_to_cart(products[{product_id, quantity}])`, `remove_from_cart(order_field_id)` |
| Objednávky | `fetch_orders`, `repeat_order(order_id)`, `get_typical_order`, `analyze_spending` | `get_order_history`, `get_order_detail`, `get_upcoming_orders`, `get_frequent_items` |
| Doručovací okna | `get_timeslots_checkout(timeslots_day "0"–"3")`, `reserve_timeslot`, `unreserve_timeslot`, `change_timeslot_checkout` | `get_delivery_slots`, `get_delivery_info` |
| Nákupní seznamy | `get_user_shopping_lists_preview`, `get_user_shopping_list_detail`, `create_shopping_list`, `add_products_to_shopping_list`, … | `get_shopping_list` |
| Recepty | `search_recipes_by_vector_similarity(query)`, `get_recipe_detail(recipe_id)` | `get_meal_suggestions(meal_type)` |
| Akce | `get_discounted_items(sale_type?, category_id?, sort?, limit?, page?)` | `get_discounted_items` |
| Oblíbené | `get_all_user_favorites` | `search_products(favourite_only=true)` |
| Pokladna | `get_checkout`, `get_checkout_link`, `update_payment_method_checkout`, `select_delivery_address_checkout` | není |

Každý oficiální nástroj bere navíc volitelné `context` a `conversation_id`. Server umí přidávat nástroje za běhu přes `get_more_tools`.

**Frida má allowlist.** Agent smí jen hledat, číst a plnit košík a vytvořit odkaz do pokladny. Nástroje `cancel_order`, `remove_order_items`, `submit_claim`, `create_scheduled_task` a `get_url_content` jsou zakázané v `frida/grocery/rohlik_mcp.py` (`ALLOWED_TOOLS`).

## Komunitní server `tomaspavlin/rohlik-mcp`

- npm [`@tomaspavlin/rohlik-mcp`](https://www.npmjs.com/package/@tomaspavlin/rohlik-mcp), verze 3.3.0, MIT, jen stdio.
- Spuštění: `npx -y @tomaspavlin/rohlik-mcp`
- Proměnné: `ROHLIK_USERNAME`, `ROHLIK_PASSWORD`, volitelně `ROHLIK_BASE_URL` (výchozí `https://www.rohlik.cz`) a `ROHLIK_DEBUG`.
- Autor píše, že jde o studijní projekt nad reverzně zjištěným API a jen pro osobní použití. Přihlašuje se cookie session přes `/services/frontend-service/login`.
- Hodí se jako záloha, kdyby OAuth u oficiálního serveru dělal potíže.

## Jak se Frida připojuje

Frida používá **lokálního MCP klienta** z Python SDK `mcp` 2.x a nástroje Rohlíku převádí na nástroje Claude. Důvody:

1. Konektor MCP v Messages API (`mcp_servers`, beta `mcp-client-2025-11-20`) posílá jen `authorization_token`. Vlastní hlavičky nepodporuje a stdio server vůbec neumí.
2. Lokální klient dovolí allowlist, logování každého volání do časové osy a demo režim se stejným rozhraním.
3. Frida potřebuje košík zobrazovat i mimo konverzaci s agentem (panel Košík v UI).

Konektor v Messages API je pořád dobrá cesta, až budeš mít platný OAuth token a veřejný server. Ukázka je v `frida/grocery/rohlik_mcp.py` v docstringu.

### Režimy v `.env`

```bash
# A) oficiální server s OAuth tokenem (doporučeno)
FRIDA_ROHLIK_MCP_URL=https://mcp.rohlik.cz/mcp
FRIDA_ROHLIK_BEARER_TOKEN=eyJ...           # access token z identity.rohlik.cz

# B) oficiální server se staršími hlavičkami (neověřeno)
FRIDA_ROHLIK_MCP_URL=https://mcp.rohlik.cz/mcp
FRIDA_ROHLIK_EMAIL=ty@example.com
FRIDA_ROHLIK_PASSWORD=...

# C) komunitní stdio server
FRIDA_ROHLIK_MCP_COMMAND="npx -y @tomaspavlin/rohlik-mcp"
FRIDA_ROHLIK_EMAIL=ty@example.com          # předá se jako ROHLIK_USERNAME
FRIDA_ROHLIK_PASSWORD=...
```

Bez těchto proměnných běží **demo košík** v paměti se stejným rozhraním.

### Získání OAuth tokenu (poslední krok, který zbývá udělat ručně)

Nejrychlejší ověření je `npx @modelcontextprotocol/inspector`, v něm „Quick OAuth Flow“ proti `https://mcp.rohlik.cz/mcp`. Výsledný access token vlož do `FRIDA_ROHLIK_BEARER_TOKEN`. Pro trvalý provoz bez zásahu je potřeba plný OAuth s refresh tokenem přes `mcp.client.auth.OAuthClientProvider`. Neověřeno: jestli identity.rohlik.cz vydává refresh token (`offline_access` mezi scopes není) a jak dlouho token platí. Tohle je hlavní otevřené riziko pro lednici, která má běžet bez dozoru.

### Test samostatně

```bash
cd backend
uv run frida rohlik-tools            # vypíše nástroje serveru a označí povolené
uv run frida rohlik-search "mléko"   # zkusí hledání
```

## Podmínky použití

Podle [podmínek MCP](https://www.rohlik.cz/stranka/mcp-server), platných od 16. 1. 2026:

- Objednávka je dokončena až potvrzením zákazníka v rozhraní e-shopu Rohlik.cz, ne přes MCP klienta. Frida proto jen plní košík a pošle ti odkaz do pokladny.
- Služba je určena pro běžné užívání e-shopu zákazníkem. Jiné použití vyžaduje předchozí písemný souhlas Rohlíku. Lednice pro vlastní domácnost tomu odpovídá. Kdybys aplikaci nabízel dalším lidem, je potřeba souhlas.
- Služba je experimentální a může se kdykoli změnit. Při rozporu ceny nebo dostupnosti platí e-shop.
- Limity požadavků nejsou zdokumentované.
