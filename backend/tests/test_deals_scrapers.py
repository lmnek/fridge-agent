"""Scrapery akcí (akcniceny.cz, kupi.cz) proti uloženým stránkám - bez sítě.

Fixtures v `tests/fixtures/deals/` jsou skutečné stránky stažené 13. 11. 2026
s User-Agentem aplikace. Hodnoty v testech jsou ověřené pohledem do HTML.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from datetime import date
from pathlib import Path

import httpx
import pytest

from frida.config import Settings
from frida.deals.akcniceny import (
    AkcnicenyDealSource,
    infer_date,
    normalize_chain,
    package_from_name,
    parse_czk,
    parse_page,
    parse_percent,
)
from frida.deals.base import DealSource, DealSourceError
from frida.deals.kupi import KupiDealSource, parse_search_page, parse_validity
from frida.schemas import Deal

FIXTURES = Path(__file__).parent / "fixtures" / "deals"
TODAY = date(2026, 11, 13)


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


@pytest.fixture
def settings() -> Settings:
    return Settings(_env_file=None)  # type: ignore[call-arg]


class FakeSite:
    """Falešný web: cesta -> (status, HTML). Zaznamenává všechny požadavky."""

    def __init__(self, pages: dict[str, tuple[int, str]]) -> None:
        self.pages = pages
        self.requests: list[httpx.Request] = []
        self.times: list[float] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        self.times.append(time.monotonic())
        status, body = self.pages.get(request.url.path, (404, "<html><body>nenalezeno</body></html>"))
        return httpx.Response(status, text=body, headers={"content-type": "text/html; charset=utf-8"})

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handler))


def akcniceny(settings: Settings, site: FakeSite, **kw) -> AkcnicenyDealSource:
    kw.setdefault("min_interval", 0)
    return AkcnicenyDealSource(settings, client=site.client(), today=lambda: TODAY, **kw)


def kupi(settings: Settings, site: FakeSite, **kw) -> KupiDealSource:
    kw.setdefault("min_interval", 0)
    return KupiDealSource(settings, client=site.client(), today=lambda: TODAY, **kw)


def find(deals: list[Deal], pred: Callable[[Deal], bool]) -> Deal:
    hits = [d for d in deals if pred(d)]
    assert len(hits) == 1, f"čekal jsem právě jednu akci, mám {len(hits)}"
    return hits[0]


# ---------------------------------------------------------------------------
# akcniceny.cz
# ---------------------------------------------------------------------------


async def test_akcniceny_search_page_is_enough(settings: Settings) -> None:
    site = FakeSite({"/hledej": (200, fixture("akcniceny_search_maslo.html"))})
    source = akcniceny(settings, site)
    assert isinstance(source, DealSource)
    assert source.name == "akcniceny"

    deals = await source.search("máslo")

    # Jen jeden požadavek: stránka hledání má všechny nabídky, stránky /akce/ se nestahují.
    assert len(site.requests) == 1
    req = site.requests[0]
    assert req.url.host == "www.akcniceny.cz"
    assert req.url.path == "/hledej"
    assert req.url.params["s"] == "máslo"
    assert req.headers["user-agent"] == settings.http_user_agent

    # 6 výrobků, 10 nabídek; Madeta u Alberta je 2× (s aplikací a bez), Tesco bez karty není akce.
    assert len(deals) == 11
    assert len({d.id for d in deals}) == 11
    assert all(d.source == "akcniceny" for d in deals)

    madeta_url = "https://www.akcniceny.cz/akce/madeta-jihoceske-maslo-250g/"
    albert_card = find(deals, lambda d: d.url == madeta_url and d.chain == "Albert" and d.requires_card)
    assert albert_card.product_name == "Madeta Jihočeské máslo 250g"
    assert albert_card.canonical == "maslo"
    assert albert_card.price_czk == 34.90
    assert albert_card.discount_pct == 36  # procento patří k ceně s aplikací Můj Albert
    assert albert_card.original_price_czk == 54.53
    assert albert_card.package == "250 g"
    assert (albert_card.unit_price, albert_card.unit_price_unit) == (139.6, "kg")
    assert albert_card.valid_from is None
    assert albert_card.valid_to == date(2026, 11, 17)
    assert albert_card.image_url == "https://cz1.staticac.cz/foto/produkty/031000/30925.jpg"

    albert_plain = find(deals, lambda d: d.url == madeta_url and d.chain == "Albert" and not d.requires_card)
    assert albert_plain.price_czk == 44.90
    assert albert_plain.discount_pct == 18  # kupi.cz uvádí u Alberta bez karty taky –18 %

    tesco = [d for d in deals if d.url == madeta_url and d.chain == "Tesco"]
    assert len(tesco) == 1  # 54,90 Kč bez Clubcard je běžná cena (–18 % = 44,90 / 54,90)
    assert tesco[0].requires_card is True
    assert tesco[0].price_czk == 44.90
    assert tesco[0].discount_pct == 18

    trefa = find(deals, lambda d: d.url == madeta_url and d.chain == "Trefa")
    assert (trefa.price_czk, trefa.discount_pct, trefa.original_price_czk) == (39.90, 27, 54.66)
    assert trefa.valid_to == date(2026, 11, 13)

    rama_albert = find(deals, lambda d: d.product_name.startswith("Rama") and d.chain == "Albert")
    assert (rama_albert.price_czk, rama_albert.discount_pct, rama_albert.package) == (54.90, 35, "400 g")
    rama_trefa = find(deals, lambda d: d.product_name.startswith("Rama") and d.chain == "Trefa")
    assert rama_trefa.discount_pct is None  # bez odznaku slevy u nabídky nic nedopočítáváme
    assert rama_trefa.original_price_czk is None

    # Budoucí akce: „Platí od: Sobota 14.11.2026“, „Platí do: 14.11.2026“.
    hera = find(deals, lambda d: d.product_name == "Hera Classic 250g")
    assert (hera.chain, hera.price_czk) == ("Tesco", 9.90)
    assert hera.valid_from == date(2026, 11, 14)
    assert hera.valid_to == date(2026, 11, 14)

    jip = find(deals, lambda d: d.chain == "JIP")
    assert (jip.product_name, jip.price_czk) == ("Créme Bonjour Roztíratelný směsný tuk 250g", 21.90)

    # Stabilní id: druhé parsování dá stejná id.
    again = parse_page(fixture("akcniceny_search_maslo.html"), today=TODAY)
    assert {d.id for d in again} == {d.id for d in deals}


def test_akcniceny_offer_page_microdata() -> None:
    deals = parse_page(fixture("akcniceny_offer_madeta_maslo.html"), today=TODAY)
    # Název je tu v <h1 itemprop="name">, platnost v priceValidUntil.
    assert {d.product_name for d in deals} == {"Madeta Jihočeské máslo 250g"}
    trefa = find(deals, lambda d: d.chain == "Trefa")
    assert (trefa.price_czk, trefa.discount_pct, trefa.valid_to) == (39.90, 27, date(2026, 11, 13))
    albert_card = find(deals, lambda d: d.chain == "Albert" and d.requires_card)
    assert (albert_card.price_czk, albert_card.discount_pct) == (34.90, 36)
    # Na stránce nabídky Tesco nemá odznak slevy -> obě ceny, bez procent.
    tesco = sorted((d.price_czk, d.requires_card, d.discount_pct) for d in deals if d.chain == "Tesco")
    assert tesco == [(44.90, True, None), (54.90, False, None)]

    # Stejná nabídka ze stránky hledání i ze stránky nabídky má stejné id.
    search_ids = {d.id for d in parse_page(fixture("akcniceny_search_maslo.html"), today=TODAY)}
    assert trefa.id in search_ids and albert_card.id in search_ids

    rama = parse_page(fixture("akcniceny_offer_rama.html"), today=TODAY)
    expected = [("Albert", 54.90), ("Hruška", 62.90), ("Trefa", 49.90)]
    assert sorted((d.chain, d.price_czk) for d in rama) == expected


MULTIBUY_OFFER = """<html><body><h1>Hledání "jogurt"</h1>
<div itemscope itemtype="http://schema.org/Product">
  <span itemprop="name" content="Jogurt bílý 150g"></span>
  <span itemprop="url" content="/akce/jogurt-bily-150g/"></span>
  <div itemprop="offers" itemscope itemtype="http://schema.org/AggregateOffer">
    <span itemprop="offerCount" content="1"></span>
    <div itemprop="offers" itemscope itemtype="http://schema.org/Offer">
      <div itemprop="seller" itemscope itemtype="http://schema.org/Organization">
        <span itemprop="name" content="Billa"></span></div>
      <span itemprop="price" content="12.90"></span><span itemprop="priceCurrency" content="CZK"></span>
      <p>12,90 Kč</p>
      <p><small>* cena za 1 ks od 3 ks</small>9,90 <span>Kč</span></p>
      <p>Platí do: <span>17.11.2026</span></p>
    </div>
  </div>
</div></body></html>"""


def test_akcniceny_multibuy_condition_is_not_a_card_price() -> None:
    # Syntetické: podmínka „od 3 ks“ má stejnou značku <small> jako cena s kartou, ale bez loga karty.
    deals = parse_page(MULTIBUY_OFFER, today=TODAY)
    assert [(d.chain, d.price_czk, d.requires_card) for d in deals] == [("Billa", 12.90, False)]
    assert deals[0].valid_to == date(2026, 11, 17)
    assert deals[0].url == "https://www.akcniceny.cz/akce/jogurt-bily-150g/"


SEARCH_WITHOUT_MICRODATA = """<html><body><h1>Hledání "máslo"</h1>
<a href="/akce/madeta-jihoceske-maslo-250g/">Madeta Jihočeské máslo 250g</a>
<a href="/akce/madeta-jihoceske-maslo-250g/">znovu stejný odkaz</a>
<a href="/zbozi/mlecne-vyrobky/masla/">kategorie, ne nabídka</a>
</body></html>"""


async def test_akcniceny_falls_back_to_offer_pages_politely(settings: Settings) -> None:
    site = FakeSite(
        {
            "/hledej": (200, SEARCH_WITHOUT_MICRODATA),
            "/akce/madeta-jihoceske-maslo-250g/": (200, fixture("akcniceny_offer_madeta_maslo.html")),
        }
    )
    source = akcniceny(settings, site, min_interval=0.2)
    deals = await source.search("máslo")
    assert [r.url.path for r in site.requests] == ["/hledej", "/akce/madeta-jihoceske-maslo-250g/"]
    assert all(r.headers["user-agent"] == settings.http_user_agent for r in site.requests)
    assert site.times[1] - site.times[0] >= 0.19  # Crawl-delay: mezi požadavky pauza
    assert {d.chain for d in deals} == {"Trefa", "Albert", "Tesco"}


async def test_akcniceny_empty_results_are_not_an_error(settings: Settings) -> None:
    # Syntetická stránka: skutečná prázdná stránka hledání nebyla k dispozici.
    site = FakeSite({"/hledej": (200, '<html><body><h1>Hledání "xyzzy"</h1><p>Nic.</p></body></html>')})
    assert await akcniceny(settings, site).search("xyzzy") == []


@pytest.mark.parametrize(
    ("status", "body"),
    [
        (503, "<html><body>Service Unavailable</body></html>"),
        (200, "<html><body><h1>Údržba webu</h1></body></html>"),  # nerozpoznaná stránka
        # rozpoznaná stránka s odkazem na nabídku, ale nic nejde přečíst
        (200, '<html><body><h1>Hledání "máslo"</h1><a href="/akce/x/">x</a></body></html>'),
    ],
)
async def test_akcniceny_errors_are_not_empty_results(settings: Settings, status: int, body: str) -> None:
    site = FakeSite({"/hledej": (status, body)})
    with pytest.raises(DealSourceError):
        await akcniceny(settings, site).search("máslo")


async def test_akcniceny_network_error(settings: Settings) -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("nedostupné", request=request)

    client = httpx.AsyncClient(transport=httpx.MockTransport(boom))
    source = AkcnicenyDealSource(settings, client=client, today=lambda: TODAY, min_interval=0)
    with pytest.raises(DealSourceError):
        await source.search("máslo")


# ---------------------------------------------------------------------------
# kupi.cz
# ---------------------------------------------------------------------------


async def test_kupi_search(settings: Settings) -> None:
    site = FakeSite({"/hledej": (200, fixture("kupi_search_maslo.html"))})
    source = kupi(settings, site)
    assert isinstance(source, DealSource)
    assert source.name == "kupi"

    deals = await source.search("máslo")

    assert len(site.requests) == 1
    req = site.requests[0]
    assert (req.url.host, req.url.path) == ("www.kupi.cz", "/hledej")
    assert dict(req.url.params) == {"f": "máslo"}  # žádné stránkování
    assert req.headers["user-agent"] == settings.http_user_agent

    # 25 řádků, z toho 2 opakované v sekci „Doporučené akce“.
    assert len(deals) == 23
    assert len({d.id for d in deals}) == 23
    assert all(d.source == "kupi" for d in deals)

    billa = find(deals, lambda d: d.id == "kupi-11423001")
    assert billa.product_name == "Máslo Tatra 250 g"
    assert billa.canonical == "maslo"
    assert billa.chain == "Billa"  # „BILLA“
    assert billa.price_czk == 29.90
    assert billa.discount_pct == 36
    assert billa.original_price_czk == 46.72
    assert billa.requires_card is True  # „Platí pro členy klubu“
    # „po 16. 11. – út 17. 11.“
    assert (billa.valid_from, billa.valid_to) == (date(2026, 11, 16), date(2026, 11, 17))
    assert billa.package == "250 g"
    assert (billa.unit_price, billa.unit_price_unit) == (119.6, "kg")  # web: 11,96 Kč / 100 g
    assert billa.url == "https://www.kupi.cz/sleva/maslo-tatra"
    assert billa.image_url == "https://img.kupi.cz/kupi/thumbs/maslo-tatra_170_340.jpg"

    madeta = [d for d in deals if d.url == "https://www.kupi.cz/sleva/maslo-jihoceske-madeta"]
    assert sorted((d.chain, d.price_czk, d.discount_pct, d.requires_card) for d in madeta) == [
        ("Albert", 34.90, 36, True),
        ("Albert", 44.90, 18, False),
        ("Tesco", 44.90, 18, True),
    ]

    kaufland = find(deals, lambda d: d.chain == "Kaufland")
    assert (kaufland.price_czk, kaufland.discount_pct) == (24.90, None)
    assert kaufland.original_price_czk == 44.90  # „Běžná cena: 44,90 Kč“
    assert (kaufland.valid_from, kaufland.valid_to) == (None, date(2026, 11, 15))  # „platí do neděle 15. 11.“

    lurpak = find(deals, lambda d: d.chain == "Ratio")
    assert lurpak.original_price_czk is None  # „Běžná cena: 0,00 Kč“ = neznámá
    assert lurpak.valid_to == date(2026, 11, 30)

    kosik = find(deals, lambda d: d.chain == "Košík.cz")
    assert (kosik.valid_from, kosik.valid_to) == (None, None)  # „aktuální“
    assert (kosik.package, kosik.unit_price, kosik.unit_price_unit) == ("0.2 l", 1145.0, "l")

    perla = sorted((d.chain, d.package, d.unit_price) for d in deals if "Perla" in d.product_name)
    assert perla == [("Billa", "950 g", 57.79), ("Penny", "450 g", 66.44)]  # balení z řádku, ne z výrobku

    chains = {d.chain for d in deals}
    assert {"Penny", "Flop", "JIP", "Albert", "Globus"} <= chains
    assert not {"Penny Market", "FLOP TOP", "BILLA", "Albert hypermarket", "JIP CC Cash & Carry"} & chains


async def test_kupi_empty_results_are_not_an_error(settings: Settings) -> None:
    # Syntetická stránka: skutečná prázdná stránka hledání nebyla k dispozici.
    page = "<html><body><h2>Výsledky hledání „xyzzy“ v lokalitě Praha</h2></body></html>"
    site = FakeSite({"/hledej": (200, page)})
    assert await kupi(settings, site).search("xyzzy") == []


@pytest.mark.parametrize(
    ("status", "body"),
    [
        (503, "<html><body>Service Unavailable</body></html>"),
        (200, "<html><body><h1>Kupi.cz</h1><p>Nová verze webu</p></body></html>"),
        (200, '<html><body><div class="discount_row" data-discount="1">rozbitý řádek</div></body></html>'),
    ],
)
async def test_kupi_errors_are_not_empty_results(settings: Settings, status: int, body: str) -> None:
    site = FakeSite({"/hledej": (status, body)})
    with pytest.raises(DealSourceError):
        await kupi(settings, site).search("máslo")


async def test_kupi_never_requests_disallowed_query(settings: Settings) -> None:
    site = FakeSite({})
    assert await kupi(settings, site).search("best website") == []  # robots.txt: /hledej?f=*website
    assert site.requests == []


# ---------------------------------------------------------------------------
# Platnost bez roku a drobné pomůcky
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "today", "expected"),
    [
        ("platí do úterý 17. 11.", TODAY, (None, date(2026, 11, 17))),
        ("po 16. 11. – út 17. 11.", TODAY, (date(2026, 11, 16), date(2026, 11, 17))),
        ("platí od čtvrtka 19. 11.", TODAY, (date(2026, 11, 19), None)),
        ("aktuální", TODAY, (None, None)),
        ("", TODAY, (None, None)),
        # přelom roku: v prosinci leták do ledna, v lednu leták od prosince
        ("platí do pátku 2. 1.", date(2026, 12, 29), (None, date(2027, 1, 2))),
        ("po 28. 12. – ne 3. 1.", date(2026, 12, 30), (date(2026, 12, 28), date(2027, 1, 3))),
        ("po 28. 12. – ne 3. 1.", date(2027, 1, 2), (date(2026, 12, 28), date(2027, 1, 3))),
        ("platí do 17. 11. 2027", TODAY, (None, date(2027, 11, 17))),  # rok uvedený = rok platí
    ],
)
def test_parse_validity_without_year(text: str, today: date, expected: tuple) -> None:
    assert parse_validity(text, today) == expected


def test_infer_date() -> None:
    assert infer_date(31, 12, date(2027, 1, 2)) == date(2026, 12, 31)
    assert infer_date(3, 1, date(2026, 12, 28)) == date(2027, 1, 3)
    assert infer_date(17, 11, TODAY) == date(2026, 11, 17)
    assert infer_date(29, 2, date(2027, 2, 20)) == date(2028, 2, 29)  # jediný existující 29. 2. v okolí
    assert infer_date(31, 4, TODAY) is None


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("2 499,90 Kč", 2499.90),
        ("34,90 Kč", 34.90),
        (" 49,90 \n Kč", 49.90),
        ("cena s aplikací Můj Albert 34,90 Kč", 34.90),
        ("Tesco Clubcard 3 cena 44,90 Kč", 44.90),  # číslo v popisku se nesmí slepit s cenou
        ("1 299 Kč", 1299.0),
        ("bez ceny", None),
    ],
)
def test_parse_czk(text: str, expected: float | None) -> None:
    assert parse_czk(text) == expected


def test_parse_percent_and_package() -> None:
    assert parse_percent("–36 %") == 36
    assert parse_percent("-35%") == 35
    assert parse_percent("bez slevy") is None
    assert package_from_name("Rama 400g, vybrané druhy") == "400 g"
    assert package_from_name("Mléko 1,5 l") == "1,5 l"
    assert package_from_name("Vejce") is None


@pytest.mark.parametrize(
    ("seller", "chain"),
    [
        ("BILLA", "Billa"),
        ("Penny Market", "Penny"),
        ("FLOP TOP", "Flop"),
        ("Albert hypermarket", "Albert"),
        ("JIP CC Cash & Carry", "JIP"),
        ("Žabka", "Žabka"),
        ("Hruška", "Hruška"),
        ("Tesco Expres", "Tesco"),
        ("Teta drogerie", "Teta drogerie"),
    ],
)
def test_normalize_chain(seller: str, chain: str) -> None:
    assert normalize_chain(seller) == chain


def test_kupi_parse_search_page_directly() -> None:
    deals = parse_search_page(fixture("kupi_search_maslo.html"), today=TODAY)
    assert len(deals) == 23
