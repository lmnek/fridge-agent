"""Zdroj akcí kupi.cz (volitelný, zapíná se přes `FRIDA_DEALS_SOURCES`).

Čte jen první stránku hledání `/hledej?f=máslo` (HTML). Nestránkuje (`page=` je
v robots.txt zakázané) a nikdy nevolá `/get-akce` ani `/get-slevy`.

Struktura stránky (13. 11. 2026):
- `div.product--wrap[data-product]` = výrobek: název v `.product_name h2`, odkaz `/sleva/{slug}`,
  obrázek v `img[data-src]`, „Běžná cena“ v `.avg_price` (průměr přes obchody, může být 0,00),
- `div.discount_row[data-product][data-discount]` = jedna akce jednoho obchodu. Řádky nejsou
  zanořené do `product--wrap`, páruje se přes `data-product`. Sekce „Doporučené akce“ opakuje
  řádky, které už jsou výše, proto deduplikace podle `data-discount`.
- platnost je bez roku: „platí do úterý 17. 11.“, „po 16. 11. – út 17. 11.“, „aktuální“.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from urllib.parse import urljoin

import httpx
from selectolax.lexbor import LexborHTMLParser, LexborNode

from ..config import Settings
from ..food.catalog import canonical_for
from ..schemas import Deal
from .akcniceny import (
    PoliteFetcher,
    deal_id,
    infer_date,
    local_today,
    normalize_chain,
    package_from_name,
    parse_czk,
    parse_number,
    parse_percent,
)
from .base import DealSourceError
from .units import unit_price

log = logging.getLogger(__name__)

BASE_URL = "https://www.kupi.cz"
SEARCH_URL = f"{BASE_URL}/hledej"  # ?f=… ; jen první stránka
MIN_INTERVAL_S = 1.1

_DM = re.compile(r"(\d{1,2})\.\s*(\d{1,2})\.(?:\s*(\d{4}))?")
_SPACES = re.compile(r"[\s  ]+")
_LEAFLET_TITLE = re.compile(r"s akcí\s+(.+)$")


class KupiDealSource:
    """Akce z kupi.cz: cena, sleva, běžná cena, cena za jednotku, platnost a „Platí pro členy klubu“."""

    name = "kupi"

    def __init__(
        self,
        settings: Settings,
        *,
        client: httpx.AsyncClient | None = None,
        today: Callable[[], date] | None = None,
        min_interval: float = MIN_INTERVAL_S,
    ) -> None:
        self.settings = settings
        self._fetcher = PoliteFetcher(settings, source=self.name, client=client, min_interval=min_interval)
        self._today = today or local_today(settings.timezone)

    async def search(self, query: str) -> list[Deal]:
        query = " ".join(query.split())
        if not query or "website" in query.lower():  # robots.txt: Disallow: /hledej?f=*website
            return []
        html, final_url = await self._fetcher.get_html(SEARCH_URL, params={"f": query})
        try:
            return parse_search_page(html, today=self._today())
        except DealSourceError as exc:
            raise DealSourceError(f"{exc} ({final_url})") from None

    async def aclose(self) -> None:
        await self._fetcher.aclose()


# ---------------------------------------------------------------------------
# Parsování
# ---------------------------------------------------------------------------


@dataclass
class _Product:
    name: str
    url: str | None
    image_url: str | None
    avg_price: float | None


def parse_search_page(html: str, *, today: date) -> list[Deal]:
    tree = LexborHTMLParser(html)
    rows = tree.css("div.discount_row")
    if not rows and not _is_search_page(tree):
        raise DealSourceError("kupi: nerozpoznaná stránka hledání")

    products = {
        pid: p
        for wrap in tree.css("div.product--wrap")
        if (pid := _attr(wrap, "data-product")) and (p := _product(wrap))
    }
    deals: dict[str, Deal] = {}
    for row in rows:
        try:
            deal = _row_deal(row, products, today)
        except (ValueError, TypeError) as exc:  # jeden rozbitý řádek nesmí shodit celé hledání
            log.debug("kupi: řádek %s přeskočen: %s", _attr(row, "data-discount"), exc)
            continue
        if deal is not None:
            deals.setdefault(deal.id, deal)
    if rows and not deals:
        raise DealSourceError("kupi: výsledky hledání jsou, ale žádnou akci se nepodařilo přečíst")
    return list(deals.values())


def _is_search_page(tree: LexborHTMLParser) -> bool:
    if tree.css_first("#product_append") is not None:
        return True
    return any("výsledky hledání" in _clean(h.text(separator=" ")).lower() for h in tree.css("h1, h2"))


def _product(wrap: LexborNode) -> _Product | None:
    heading = wrap.css_first(".product_name h2")
    if heading is None:
        return None
    name = _clean(heading.text(separator=" "))
    if not name:
        return None
    link = heading.css_first("a[href]")
    href = _attr(link, "href") if link else None
    image = None
    for img in wrap.css("img"):
        src = _attr(img, "data-src") or _attr(img, "src")
        if src and "/no_img/" not in src and "loga_shopy" not in src and not src.startswith("data:"):
            image = urljoin(BASE_URL + "/", src)
            break
    avg_node = wrap.css_first(".avg_price span") or wrap.css_first(".avg_price")
    avg = parse_number(avg_node.text(separator=" ")) if avg_node else None
    return _Product(
        name=name,
        url=urljoin(BASE_URL + "/", href) if href else None,
        image_url=image,
        avg_price=avg if avg and avg > 0 else None,
    )


def _row_deal(row: LexborNode, products: dict[str, _Product], today: date) -> Deal | None:
    discount_key = _attr(row, "data-discount")
    product = products.get(_attr(row, "data-product") or "")
    if product is None:
        product = _product_from_row(row)
        if product is None:
            return None

    shop = _text(row, ".discounts_shop_name")
    if not shop:
        logo = row.css_first(".discounts_shop_image a[title]")
        shop = _clean((_attr(logo, "title") or "").removesuffix(" leták")) if logo else ""
    price = parse_czk(_text(row, ".discount_price_value"))
    if not shop or price is None or price <= 0:
        return None

    package = _clean(_text(row, ".discount_amount").lstrip("/")) or _package_from_key(_attr(row, "data-key"))
    package = package or package_from_name(product.name)
    pct = parse_percent(_text(row, ".discount_percentage"))
    if pct:
        original: float | None = round(price / (1 - pct / 100), 2)
    else:
        original = product.avg_price if product.avg_price and product.avg_price > price else None
    valid_from, valid_to = parse_validity(_text(row, ".discounts_validity"), today)
    requires_card = bool(_text(row, ".discounts_club"))
    chain = normalize_chain(shop)
    up = unit_price(price, package)
    # data-discount je id akce na kupi.cz, takže je stabilní napříč stahováními.
    did = (
        f"kupi-{discount_key}"
        if discount_key
        else deal_id("kupi", product.url or product.name, chain, f"{price:.2f}")
    )
    return Deal(
        id=did,
        product_name=product.name,
        canonical=canonical_for(product.name),
        chain=chain,
        price_czk=price,
        original_price_czk=original,
        discount_pct=pct,
        unit_price=up[0] if up else None,
        unit_price_unit=up[1] if up else None,  # type: ignore[arg-type]
        package=package or None,
        valid_from=valid_from,
        valid_to=valid_to,
        requires_card=requires_card,
        source="kupi",
        url=product.url,
        image_url=product.image_url,
    )


def _product_from_row(row: LexborNode) -> _Product | None:
    """Záloha, když chybí blok výrobku: název z tlačítka letáku („Prohlédnout leták X s akcí NÁZEV“)."""
    btn = row.css_first("a.btn_link_leaflet[title]")
    m = _LEAFLET_TITLE.search(_attr(btn, "title") or "") if btn else None
    if not m:
        return None
    slug_link = row.css_first("a[data-product]")
    slug = _attr(slug_link, "data-product") if slug_link else None
    return _Product(
        name=_clean(m[1]), url=f"{BASE_URL}/sleva/{slug}" if slug else None, image_url=None, avg_price=None
    )


def parse_validity(text: str | None, today: date) -> tuple[date | None, date | None]:
    """Platnost bez roku -> (od, do). Rok se dopočítá vůči dnešku (přelom prosinec/leden).

    'platí do úterý 17. 11.' -> (None, 17. 11.), 'po 16. 11. – út 17. 11.' -> (16. 11., 17. 11.),
    'platí od čtvrtka 19. 11.' -> (19. 11., None), 'aktuální' -> (None, None).
    """
    text = _clean(text)
    matches = list(_DM.finditer(text))
    dates = [infer_date(int(m[1]), int(m[2]), today, year=int(m[3]) if m[3] else None) for m in matches]
    if not dates:
        return None, None
    if len(dates) >= 2:
        start, end = dates[0], dates[-1]
        if start and end and end < start and not matches[-1][3]:
            end = infer_date(end.day, end.month, today, year=end.year + 1)
        return start, end
    before = text[: matches[0].start()].lower()
    if re.search(r"\bod\b", before) and not re.search(r"\bdo\b", before):
        return dates[0], None
    return None, dates[0]


def _package_from_key(key: str | None) -> str | None:
    """data-key '250-g' -> '250 g', '0.2-l' -> '0.2 l'."""
    if not key:
        return None
    return key.replace("-", " ").strip() or None


def _attr(node: LexborNode | None, name: str) -> str | None:
    if node is None:
        return None
    value = node.attributes.get(name)
    return value.strip() if value else None


def _text(node: LexborNode, selector: str) -> str:
    found = node.css_first(selector)
    return _clean(found.text(separator=" ")) if found else ""


def _clean(text: str | None) -> str:
    return _SPACES.sub(" ", text or "").strip()
