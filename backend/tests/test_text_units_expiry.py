from datetime import date

import pytest

from frida.deals.units import parse_package, unit_price
from frida.text import czk, km, normalize, similarity
from frida.vision.expiry import parse_expiry

TODAY = date(2026, 11, 13)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Spotřebujte do: 21.11.2026", date(2026, 11, 21)),
        ("Minimální trvanlivost do 05.01.27", date(2027, 1, 5)),
        ("EXP 2026-12-03", date(2026, 12, 3)),
        ("spotřebujte do 18. 11.", date(2026, 11, 18)),
        ("12/2026", date(2026, 12, 31)),
    ],
)
def test_parse_expiry(text, expected):
    parsed = parse_expiry(text, today=TODAY)
    assert parsed is not None
    assert parsed.on == expected


def test_parse_expiry_garbage():
    assert parse_expiry("Madeta mléko 1,5 %", today=TODAY) is None


@pytest.mark.parametrize(
    ("text", "expected"),
    [("500 g", (0.5, "kg")), ("1 l", (1.0, "l")), ("2x 500 ml", (1.0, "l")), ("10 ks", (10.0, "ks"))],
)
def test_parse_package(text, expected):
    amount, unit = parse_package(text)
    assert (round(amount, 3), unit) == expected


def test_unit_price():
    assert unit_price(24.9, "500 g") == (49.8, "kg")


def test_text_helpers():
    assert normalize("Máslo  ČERSTVÉ!") == "maslo cerstve"
    assert similarity("máslo", "Máslo Tatra 250 g") > similarity("máslo", "Mléko polotučné")
    assert czk(49) == "49 Kč"
    assert czk(30.1) == "30,10 Kč"
    assert km(279) == "280 m"
    assert km(1852) == "1,9 km"
