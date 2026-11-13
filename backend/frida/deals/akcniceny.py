"""Zdroj akcí akcniceny.cz (výchozí).

Stačí jeden požadavek: stránka hledání `/hledej?s=máslo` obsahuje u každého výrobku
mikrodata Product → AggregateOffer → Offer a u každé nabídky je vidět obchod, cena,
sleva v %, cena s věrnostní kartou/aplikací, „Platí do“ a u budoucích akcí „Platí od“.
Stránky nabídek `/akce/{slug}/` mají stejnou strukturu (a navíc `priceValidUntil`),
proto je stahujeme jen jako zálohu, když na stránce hledání nabídky chybí.

Zjištěno na živých datech (13. 11. 2026): když má nabídka i cenu s kartou
(„cena s aplikací Můj Albert“, „Tesco Clubcard cena“), procento slevy patří k té
nižší ceně s kartou. Kupi.cz to potvrzuje (Albert 34,90 Kč –36 % pro členy klubu,
44,90 Kč –18 % bez karty). Původní cenu proto dopočítáváme z ceny s kartou.

Na konci modulu jsou společné pomůcky pro scrapery (ceny, řetězce, data bez roku,
slušné stahování), které používá i `kupi.py`.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from urllib.parse import urljoin
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from selectolax.lexbor import LexborHTMLParser, LexborNode

from ..config import Settings
from ..food.catalog import canonical_for
from ..schemas import Deal
from .base import DealSourceError
from .units import unit_price

log = logging.getLogger(__name__)

BASE_URL = "https://www.akcniceny.cz"
SEARCH_URL = f"{BASE_URL}/hledej"  # ?s=… (parametr q= přesměruje na úvodní stránku)
CRAWL_DELAY_S = 1.1  # robots.txt: Crawl-delay: 1
MAX_OFFER_PAGES = 6


# ---------------------------------------------------------------------------
# Zdroj
# ---------------------------------------------------------------------------


class AkcnicenyDealSource:
    """Akce z akcniceny.cz. Primárně čte stránku hledání, stránky nabídek jen jako zálohu."""

    name = "akcniceny"

    def __init__(
        self,
        settings: Settings,
        *,
        client: httpx.AsyncClient | None = None,
        today: Callable[[], date] | None = None,
        min_interval: float = CRAWL_DELAY_S,
        max_offer_pages: int = MAX_OFFER_PAGES,
    ) -> None:
        self.settings = settings
        self._fetcher = PoliteFetcher(settings, source=self.name, client=client, min_interval=min_interval)
        self._today = today or local_today(settings.timezone)
        self.max_offer_pages = max_offer_pages

    async def search(self, query: str) -> list[Deal]:
        query = " ".join(query.split())
        if not query:
            return []
        today = self._today()
        html, final_url = await self._fetcher.get_html(SEARCH_URL, params={"s": query})
        tree = LexborHTMLParser(html)
        if not _is_search_page(tree):
            raise DealSourceError(f"akcniceny: nerozpoznaná stránka hledání ({final_url})")

        products = _parse_products(tree, today)
        deals_by_product: dict[str, list[Deal]] = {}
        to_fetch: list[str] = []
        for p in products:
            key = p.url or f"#{len(deals_by_product)}"
            deals_by_product[key] = p.deals
            # Nabídky chybí nebo jich je méně, než hlásí AggregateOffer -> dočíst stránku nabídky.
            if p.url and (p.offer_nodes == 0 or (p.offer_count or 0) > p.offer_nodes):
                to_fetch.append(p.url)
        links = _offer_links(tree)
        if not products:
            to_fetch = links  # mikrodata zmizela, ale odkazy na nabídky zůstaly

        for url in to_fetch[: self.max_offer_pages]:
            try:
                offer_html, _ = await self._fetcher.get_html(url)
            except DealSourceError as exc:
                log.warning("akcniceny: stránku nabídky %s se nepodařilo načíst: %s", url, exc)
                continue
            for p in _parse_products(LexborHTMLParser(offer_html), today):
                if p.deals:
                    deals_by_product[p.url or url] = p.deals

        deals = _unique([d for ds in deals_by_product.values() for d in ds])
        if not deals and (products or links):
            raise DealSourceError(
                "akcniceny: výsledky hledání jsou, ale žádnou nabídku se nepodařilo přečíst"
            )
        return deals

    async def aclose(self) -> None:
        await self._fetcher.aclose()


def parse_page(html: str, *, today: date) -> list[Deal]:
    """Akce ze stránky hledání i ze stránky nabídky (obě mají mikrodata Product → Offer)."""
    return _unique([d for p in _parse_products(LexborHTMLParser(html), today) for d in p.deals])


# ---------------------------------------------------------------------------
# Parsování mikrodat
# ---------------------------------------------------------------------------


@dataclass
class _Product:
    name: str
    url: str | None
    image_url: str | None
    package: str | None
    offer_count: int | None
    offer_nodes: int = 0
    deals: list[Deal] = field(default_factory=list)


_DATE = r"(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})?"
_VALID_TO = re.compile(r"Platí\s+do:?\s*\D{0,15}?" + _DATE, re.IGNORECASE)
_VALID_FROM = re.compile(r"Platí\s+od:?\s*\D{0,15}?" + _DATE, re.IGNORECASE)
_DAYS_LEFT = re.compile(r"Zbývá\s+(\d+)\s+d", re.IGNORECASE)
_CARD_WORDS = re.compile(r"clubcard|kart|aplikac|bonus|plus|klub|clen")  # porovnává se bez diakritiky


def _is_search_page(tree: LexborHTMLParser) -> bool:
    h1 = tree.css_first("h1")
    return h1 is not None and _clean(h1.text(separator=" ")).lower().startswith("hledání")


def _itemtype(node: LexborNode, kind: str) -> bool:
    return (node.attributes.get("itemtype") or "").rstrip("/").endswith(f"schema.org/{kind}")


def _scope_of(node: LexborNode) -> LexborNode | None:
    """Nejbližší předek s `itemscope` - komu daná vlastnost patří."""
    parent = node.parent
    while parent is not None and parent.tag != "html":
        if "itemscope" in parent.attributes:
            return parent
        parent = parent.parent
    return None


def _own(scope: LexborNode, prop: str) -> list[LexborNode]:
    """Vlastnosti `itemprop=prop` patřící přímo tomuto scope (ne vnořenému prodejci apod.)."""
    out = []
    for node in scope.css(f'[itemprop="{prop}"]'):
        owner = _scope_of(node)
        if owner is not None and owner.mem_id == scope.mem_id:
            out.append(node)
    return out


def _value(node: LexborNode | None) -> str | None:
    if node is None:
        return None
    attrs = node.attributes
    for attr in ("content", "href", "src"):
        if attrs.get(attr):
            return (attrs[attr] or "").strip()
    text = _clean(node.text(separator=" "))
    return text or None


def _own_value(scope: LexborNode, prop: str) -> str | None:
    nodes = _own(scope, prop)
    return _value(nodes[0]) if nodes else None


def _parse_products(tree: LexborHTMLParser, today: date) -> list[_Product]:
    products: list[_Product] = []
    for node in tree.css("[itemtype]"):
        if not _itemtype(node, "Product"):
            continue
        name = _own_value(node, "name")
        if not name:
            continue
        url = _own_value(node, "url")
        url = urljoin(BASE_URL + "/", url) if url else None
        image = _own_value(node, "image")
        offer_count = None
        for agg in node.css("[itemtype]"):
            if _itemtype(agg, "AggregateOffer"):
                offer_count = _to_int(_own_value(agg, "offerCount"))
                break
        product = _Product(
            name=name,
            url=url,
            image_url=urljoin(BASE_URL + "/", image) if image else None,
            package=package_from_name(name),
            offer_count=offer_count,
        )
        for offer in node.css("[itemtype]"):
            if not _itemtype(offer, "Offer"):
                continue
            product.offer_nodes += 1
            product.deals.extend(_offer_deals(offer, product, today))
        products.append(product)
    return products


def _offer_deals(offer: LexborNode, product: _Product, today: date) -> list[Deal]:
    """Jedna nabídka obchodu -> 1 akce, případně 2 (běžná cena v akci + cena s kartou)."""
    seller = None
    for org in _own(offer, "seller"):
        seller = _own_value(org, "name") or _value(org)
        break
    if not seller:
        heading = offer.css_first("h2, h3")
        seller = _clean(heading.text(separator=" ")) if heading else None
    if not seller:
        return []

    currency = _own_value(offer, "priceCurrency")
    if currency and currency.upper() != "CZK":
        return []
    base = _to_float(_own_value(offer, "price"))
    if base is None:
        first_p = offer.css_first("p")
        base = parse_czk(first_p.text(separator=" ")) if first_p else None
    if base is None or base <= 0:
        return []

    badge = offer.css_first(".badge")
    pct = parse_percent(badge.text(separator=" ")) if badge else None
    card = _card_price(offer)
    if card is not None and card >= base:
        card = None

    text = _clean(offer.text(separator=" "))
    valid_from = _match_date(_VALID_FROM, text, today)
    valid_to = _iso_date(_own_value(offer, "priceValidUntil")) or _match_date(_VALID_TO, text, today)
    if valid_to is None and (m := _DAYS_LEFT.search(text)):
        valid_to = today + timedelta(days=max(int(m[1]) - 1, 0))

    lowest = card if card is not None else base
    original = round(lowest / (1 - pct / 100), 2) if pct and 0 < pct < 100 else None

    def make(price: float, discount: int | None, orig: float | None, requires_card: bool) -> Deal:
        chain = normalize_chain(seller)
        up = unit_price(price, product.package)
        return Deal(
            id=deal_id(
                "akcniceny",
                product.url or product.name,
                chain,
                f"{price:.2f}",
                "karta" if requires_card else "",
            ),
            product_name=product.name,
            canonical=canonical_for(product.name),
            chain=chain,
            price_czk=price,
            original_price_czk=orig,
            discount_pct=discount,
            unit_price=up[0] if up else None,
            unit_price_unit=up[1] if up else None,  # type: ignore[arg-type]
            package=product.package,
            valid_from=valid_from,
            valid_to=valid_to,
            requires_card=requires_card,
            source="akcniceny",
            url=product.url,
            image_url=product.image_url,
        )

    if card is None:
        return [make(base, pct, original, False)]
    deals = [make(card, pct, original, True)]
    if original is None:
        deals.append(make(base, None, None, False))  # bez procenta nevíme, jestli je cena bez karty akční
    else:
        base_pct = round((1 - base / original) * 100)
        if base_pct >= 1:  # jinak je cena bez karty jen běžná cena, ne akce
            deals.append(make(base, base_pct, original, False))
    return deals


def _card_price(offer: LexborNode) -> float | None:
    """Cena s věrnostní kartou/aplikací: <p><small>Tesco Clubcard cena</small>44,90 Kč<img card…></p>.

    Jiné podmínky („cena za 1 ks od 3 ks“) za kartu nepovažujeme - musí tam být logo karty
    nebo slovo jako Clubcard/karta/aplikace.
    """
    for p in offer.css("p"):
        small = p.css_first("small")
        if small is None:
            continue
        label = small.text(separator=" ")
        has_logo = any("/retezce/card" in (img.attributes.get("src") or "") for img in p.css("img"))
        if not has_logo and not _CARD_WORDS.search(_fold(label)):
            continue
        rest = p.text(separator=" ").replace(label, " ", 1)
        price = parse_czk(rest)
        if price is not None:
            return price
    return None


def _offer_links(tree: LexborHTMLParser) -> list[str]:
    seen: dict[str, None] = {}
    for a in tree.css("a[href]"):
        href = urljoin(BASE_URL + "/", a.attributes.get("href") or "")
        if href.startswith(f"{BASE_URL}/akce/") and href.rstrip("/") != f"{BASE_URL}/akce":
            seen.setdefault(href.split("#", 1)[0], None)
    return list(seen)


def _match_date(pattern: re.Pattern[str], text: str, today: date) -> date | None:
    m = pattern.search(text)
    if not m:
        return None
    return infer_date(int(m[1]), int(m[2]), today, year=int(m[3]) if m[3] else None)


def _iso_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _unique(deals: list[Deal]) -> list[Deal]:
    return list({d.id: d for d in deals}.values())


# ---------------------------------------------------------------------------
# Společné pomůcky pro scrapery (používá i kupi.py)
# ---------------------------------------------------------------------------

_SPACES = re.compile(r"[\s   ]+")
_CZK = re.compile(r"(?<![\d.,])(\d{1,3}(?:[    ]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(?:Kč|CZK|,-)")
_NUMBER = re.compile(r"(?<![\d.,])(\d{1,3}(?:[    ]\d{3})+|\d+)(?:[.,](\d{1,2}))?(?![\d])")
_PERCENT = re.compile(r"(\d{1,2})\s*%")
_PACKAGE_TEXT = re.compile(
    r"(?<![\w.,])(?:\d+\s*[x×]\s*)?\d+(?:[.,]\d+)?\s*(?:kg|dkg|g|ml|cl|l|ks)\b", re.IGNORECASE
)

# Klíč = slovo z názvu prodejce bez diakritiky, hodnota = název řetězce jako v geo/service.py.
_CHAINS = {
    "albert": "Albert",
    "lidl": "Lidl",
    "billa": "Billa",
    "kaufland": "Kaufland",
    "penny": "Penny",
    "tesco": "Tesco",
    "globus": "Globus",
    "coop": "Coop",
    "norma": "Norma",
    "zabka": "Žabka",
    "flop": "Flop",
    "hruska": "Hruška",
    "makro": "Makro",
    "jip": "JIP",
}


def _clean(text: str | None) -> str:
    return _SPACES.sub(" ", text or "").strip()


def _fold(text: str) -> str:
    """Malá písmena bez diakritiky."""
    return "".join(c for c in unicodedata.normalize("NFKD", text.lower()) if not unicodedata.combining(c))


def _number(int_part: str, dec_part: str | None) -> float:
    return float(_SPACES.sub("", int_part) + "." + (dec_part or "0"))


def parse_czk(text: str | None) -> float | None:
    """'2 499,90 Kč' -> 2499.9. Bere první číslo, za kterým je 'Kč' (případně jen číslo)."""
    if not text:
        return None
    m = _CZK.search(text) or _NUMBER.search(text)
    return _number(m[1], m[2]) if m else None


def parse_number(text: str | None) -> float | None:
    """'58,27' -> 58.27, '2 499,90' -> 2499.9."""
    if not text:
        return None
    m = _NUMBER.search(text)
    return _number(m[1], m[2]) if m else None


def parse_percent(text: str | None) -> int | None:
    """'–36 %', '-35%' -> 36 / 35 (sleva jako kladné číslo)."""
    if not text:
        return None
    m = _PERCENT.search(_clean(text))
    if not m:
        return None
    pct = int(m[1])
    return pct if 0 < pct < 100 else None


def package_from_name(name: str | None) -> str | None:
    """'Rama 400g, vybrané druhy' -> '400 g'."""
    if not name:
        return None
    m = _PACKAGE_TEXT.search(name)
    if not m:
        return None
    return re.sub(r"(\d)\s*([a-zA-Z]+)$", r"\1 \2", _clean(m[0]))


def normalize_chain(seller: str) -> str:
    """'Penny Market' -> 'Penny', 'FLOP TOP' -> 'Flop', 'JIP CC Cash & Carry' -> 'JIP'. Neznámé nechá být."""
    for token in re.findall(r"[a-z0-9]+", _fold(seller)):
        if token in _CHAINS:
            return _CHAINS[token]
    return _clean(seller)


def infer_date(day: int, month: int, today: date, *, year: int | None = None) -> date | None:
    """Datum z letáku. Bez roku vybere rok, ve kterém je datum nejblíž dnešku (prosinec -> leden)."""
    if year is not None:
        try:
            return date(year, month, day)
        except ValueError:
            return None
    candidates = []
    for y in (today.year - 1, today.year, today.year + 1):
        try:
            candidates.append(date(y, month, day))
        except ValueError:
            continue
    return min(candidates, key=lambda d: abs((d - today).days)) if candidates else None


def deal_id(source: str, *parts: str) -> str:
    """Stabilní id akce (stejná nabídka = stejné id napříč stahováními)."""
    digest = hashlib.sha1("|".join(parts).encode(), usedforsecurity=False).hexdigest()[:16]
    return f"{source}-{digest}"


def local_today(timezone: str) -> Callable[[], date]:
    """Dnešní datum v časové zóně aplikace. Volá se při každém hledání (server běží přes půlnoc)."""
    try:
        tz = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError):
        return date.today
    return lambda: datetime.now(tz).date()


def _to_float(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return float(value.replace(",", "."))
    except ValueError:
        return parse_number(value)


def _to_int(value: str | None) -> int | None:
    f = _to_float(value)
    return int(f) if f is not None else None


class PoliteFetcher:
    """Slušné stahování: User-Agent aplikace, timeout a nejvýš jeden požadavek za `min_interval` s.

    Zámek drží pauzu i samotný požadavek, takže platí i při souběžném hledání víc dotazů
    (`DealService.search_many` je spouští přes `asyncio.gather`).
    """

    def __init__(
        self,
        settings: Settings,
        *,
        source: str,
        client: httpx.AsyncClient | None = None,
        min_interval: float = CRAWL_DELAY_S,
        timeout_s: float = 15.0,
    ) -> None:
        self.source = source
        self._client = client
        self._owns_client = client is None
        self._min_interval = max(min_interval, 0.0)
        self._timeout = httpx.Timeout(timeout_s, connect=min(timeout_s, 5.0))
        self._headers = {
            "User-Agent": settings.http_user_agent,
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
            "Accept-Language": "cs-CZ,cs;q=0.9",
        }
        self._lock = asyncio.Lock()
        self._last: float | None = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient()
        return self._client

    async def get_html(self, url: str, *, params: dict[str, str] | None = None) -> tuple[str, httpx.URL]:
        async with self._lock:
            if self._last is not None:
                wait = self._last + self._min_interval - time.monotonic()
                if wait > 0:
                    await asyncio.sleep(wait)
            try:
                response = await self._http().get(
                    url, params=params, headers=self._headers, timeout=self._timeout, follow_redirects=True
                )
            except httpx.HTTPError as exc:
                raise DealSourceError(f"{self.source}: {url} je nedostupné ({type(exc).__name__})") from exc
            finally:
                self._last = time.monotonic()
        if response.status_code != 200:
            raise DealSourceError(f"{self.source}: HTTP {response.status_code} z {response.url}")
        return response.text, response.url

    async def aclose(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None
