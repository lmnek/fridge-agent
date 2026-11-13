"""Co uvařit z toho, co je v lednici, s přednostním použitím věcí, kterým končí trvanlivost.

Dvě cesty:
- s klíčem Anthropic skládá recepty Claude (strukturovaný výstup) přímo
  z aktuálního obsahu lednice, s ohledem na dietu a alergeny,
- bez klíče (nebo když volání selže) vybírá z vestavěné sbírky receptů níže
  a boduje je podle toho, kolik potravin zachrání.

Prošlé potraviny se do receptů nikdy nepočítají.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from anthropic import AsyncAnthropic
from pydantic import BaseModel

from ..ai import request_kwargs
from ..config import Settings
from ..food.catalog import BY_KEY
from ..schemas import CravingAnswer, DeliveryVenue, GeoPoint, InventoryItem, RecipeSuggestion, UserPreferences
from ..text import normalize, similarity
from .delivery import DeliveryProvider, delivery_options, detect_cuisine

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Recipe:
    id: str
    title: str
    emoji: str
    minutes: int
    needs: tuple[str, ...]  # klíče z katalogu, bez kterých to nejde
    optional: tuple[str, ...] = ()
    pantry: tuple[str, ...] = ()  # trvanlivé věci ze spíže (těstoviny, rýže, mouka), předpokládáme doma
    buy_extra: tuple[str, ...] = ()  # věci mimo lednici, které je potřeba koupit
    tags: tuple[str, ...] = ()
    steps: tuple[str, ...] = ()


# Vlastní jednoduché recepty Fridy. Krátké, aby šly přečíst i nahlas v hovoru.
RECIPES: tuple[Recipe, ...] = (
    Recipe(
        "shakshuka",
        "Šakšuka s paprikou",
        "🍳",
        25,
        ("vejce", "rajcata"),
        ("paprika", "cibule", "cesnek"),
        ("olej", "kmín"),
        (),
        ("snidane", "vegetarian", "teple"),
        (
            "Na oleji osmahni cibuli, česnek a papriku.",
            "Přidej nakrájená rajčata a 10 minut dus.",
            "Udělej důlky, rozklepni do nich vejce a pod pokličkou nech 6 minut dojít.",
        ),
    ),
    Recipe(
        "wrap-kure",
        "Kuřecí wrap s jogurtem",
        "🌯",
        20,
        ("tortilly", "kureci-prsa"),
        ("salat", "rajcata", "okurka", "jogurt-bily"),
        ("olej", "sůl"),
        (),
        ("rychle", "mexicke"),
        (
            "Kuřecí prsa nakrájej na nudličky, osol a opeč dozlatova.",
            "Jogurt smíchej se strouhanou okurkou a špetkou soli.",
            "Tortillu nahřej na suché pánvi, naplň kuřetem, zeleninou a dresinkem a zaroluj.",
        ),
    ),
    Recipe(
        "testoviny-pesto",
        "Těstoviny s pestem a rajčaty",
        "🍝",
        15,
        ("pesto",),
        ("rajcata", "parmezan", "cesnek"),
        ("těstoviny",),
        (),
        ("italske", "testoviny", "vegetarian", "rychle", "pizza"),
        (
            "Uvař těstoviny v osolené vodě.",
            "Rajčata rozpůl a krátce prohřej na pánvi.",
            "Smíchej s pestem a trochou vody z těstovin, posyp parmazánem.",
        ),
    ),
    Recipe(
        "pizza-toast",
        "Pizza toasty",
        "🍕",
        15,
        ("toustovy-chleb", "syr-eidam"),
        ("sunka", "mozzarella", "rajcata", "kecup", "zampiony", "salam"),
        ("oregano",),
        (),
        ("pizza", "italske", "rychle"),
        (
            "Toasty potři kečupem nebo rozmačkanými rajčaty.",
            "Obloz šunkou nebo salámem a žampiony, navrch sýr.",
            "Zapeč v troubě na 220 °C asi 8 minut, posyp oreganem.",
        ),
    ),
    Recipe(
        "pizza-listove",
        "Domácí pizza z listového těsta",
        "🍕",
        30,
        ("syr-eidam",),
        ("mozzarella", "sunka", "salam", "zampiony", "paprika", "rajcata"),
        ("oregano", "olivový olej"),
        ("listové těsto", "rajčatový protlak"),
        ("pizza", "italske"),
        (
            "Listové těsto rozválej na plech s pečicím papírem a okraje přehni.",
            "Potři protlakem ochuceným oreganem a trochou oleje.",
            "Obloz, co je v lednici, posyp nastrouhaným sýrem.",
            "Peč na 220 °C asi 15 minut, dokud není těsto zlatavé.",
        ),
    ),
    Recipe(
        "losos-brokolice",
        "Losos s brokolicí a citronem",
        "🐟",
        25,
        ("losos", "brokolice"),
        ("citron", "maslo", "cesnek"),
        ("sůl", "pepř"),
        (),
        ("zdrave", "ryba", "teple"),
        (
            "Brokolici rozděl na růžičky a 4 minuty vař v páře.",
            "Lososa osol a opeč na másle z každé strany 3 minuty.",
            "Na závěr přidej česnek a zakápni citronem.",
        ),
    ),
    Recipe(
        "rizoto-zampiony",
        "Žampionové rizoto",
        "🍄",
        35,
        ("zampiony", "cibule"),
        ("smetana", "parmezan", "maslo"),
        ("rýže arborio", "vývar"),
        (),
        ("italske", "vegetarian", "teple"),
        (
            "Na másle osmahni cibuli a žampiony.",
            "Přidej rýži, zalévej postupně horkým vývarem a míchej 18 minut.",
            "Vmíchej lžíci smetany a parmazán.",
        ),
    ),
    Recipe(
        "michana-vejce",
        "Míchaná vejce se šunkou",
        "🍳",
        10,
        ("vejce",),
        ("sunka", "maslo", "mleko", "cibule"),
        ("sůl",),
        (),
        ("snidane", "rychle"),
        (
            "Vejce rozšlehej se lžící mléka a solí.",
            "Na másle osmahni šunku a cibulku.",
            "Vlij vejce a na mírném ohni jemně míchej, dokud nejsou krémová.",
        ),
    ),
    Recipe(
        "livance",
        "Tvarohové lívance",
        "🥞",
        25,
        ("tvaroh", "vejce"),
        ("mleko", "jahody", "dzem", "jogurt-bily"),
        ("hladká mouka", "cukr", "prášek do pečiva"),
        (),
        ("sladke", "snidane", "vegetarian"),
        (
            "Smíchej tvaroh, vejce, 4 lžíce mouky, lžíci cukru a trochu prášku do pečiva.",
            "Na pánvi s troškou oleje peč malé lívance z obou stran dozlatova.",
            "Podávej s ovocem, džemem nebo jogurtem.",
        ),
    ),
    Recipe(
        "jogurt-ovoce",
        "Jogurt s ovocem",
        "🍓",
        5,
        ("jogurt-bily",),
        ("jahody", "jablka", "hrozny", "dzem"),
        (),
        (),
        ("sladke", "snidane", "rychle", "vegetarian", "zdrave"),
        ("Ovoce nakrájej.", "Navrstvi jogurt a ovoce do misky, můžeš přidat lžičku džemu nebo medu."),
    ),
    Recipe(
        "salat-mozzarella",
        "Salát s mozzarellou",
        "🥗",
        10,
        ("salat", "rajcata"),
        ("mozzarella", "okurka", "paprika", "avokado", "citron"),
        ("olivový olej", "sůl"),
        (),
        ("zdrave", "vegetarian", "salat", "rychle"),
        (
            "Zeleninu nakrájej na kousky.",
            "Přidej natrhanou mozzarellu.",
            "Dochuť olivovým olejem, citronem a solí.",
        ),
    ),
    Recipe(
        "bolonske",
        "Boloňské špagety",
        "🍝",
        40,
        ("mlete-maso", "rajcata"),
        ("cibule", "cesnek", "mrkev", "parmezan"),
        ("špagety", "olej"),
        (),
        ("italske", "testoviny", "maso", "teple"),
        (
            "Na oleji osmahni cibuli, česnek a nastrouhanou mrkev.",
            "Přidej maso a opeč, až se rozpadne a zhnědne.",
            "Přidej rajčata a 20 minut dus.",
            "Podávej se špagetami a parmazánem.",
        ),
    ),
    Recipe(
        "stir-fry",
        "Kuřecí stir-fry se zeleninou",
        "🥢",
        25,
        ("kureci-prsa",),
        ("paprika", "brokolice", "mrkev", "cesnek", "cibule", "zampiony"),
        ("rýže", "sójová omáčka", "olej"),
        (),
        ("asijske", "maso", "teple", "zdrave"),
        (
            "Uvař rýži.",
            "Kuře nakrájej na nudličky a ve velmi horké pánvi prudce opeč.",
            "Přidej zeleninu a 4 minuty restuj, aby zůstala křupavá.",
            "Dochuť sójovou omáčkou a česnekem.",
        ),
    ),
    Recipe(
        "peceny-hermelin",
        "Pečený hermelín s česnekem",
        "🧀",
        15,
        ("hermelin",),
        ("cesnek", "toustovy-chleb"),
        ("olej", "pepř"),
        (),
        ("k-pivu", "vegetarian", "teple"),
        (
            "Hermelín nařízni, vlož do něj plátky česneku a pokapej olejem.",
            "Peč 10 minut na 200 °C.",
            "Podávej s opečeným toastem.",
        ),
    ),
    Recipe(
        "avokado-toast",
        "Avokádový toast s vejcem",
        "🥑",
        10,
        ("avokado", "toustovy-chleb"),
        ("vejce", "citron"),
        ("sůl", "chilli"),
        (),
        ("snidane", "zdrave", "rychle", "vegetarian"),
        (
            "Avokádo rozmačkej s citronem a solí.",
            "Toast opeč a namaž avokádem.",
            "Navrch dej sázené nebo vejce natvrdo a špetku chilli.",
        ),
    ),
    Recipe(
        "parky-horcice",
        "Párky s hořčicí",
        "🌭",
        10,
        ("parky",),
        ("horcice", "toustovy-chleb", "kecup"),
        (),
        (),
        ("rychle", "k-pivu", "maso"),
        ("Párky vlož do horké vody a 5 minut je nech prohřát, nevař je.", "Podávej s hořčicí a pečivem."),
    ),
    Recipe(
        "frittata-zbytky",
        "Frittata ze zbytků",
        "🍳",
        20,
        ("vejce", "zbytky-jidla"),
        ("syr-eidam", "cibule", "paprika"),
        ("olej",),
        (),
        ("zachrana", "teple"),
        (
            "Zbytky nakrájej a ohřej na pánvi.",
            "Zalij rozšlehanými vejci, posyp sýrem.",
            "Pod pokličkou nech na mírném ohni 8 minut ztuhnout.",
        ),
    ),
    Recipe(
        "mrkvovy-salat",
        "Mrkvový salát s jablkem",
        "🥕",
        10,
        ("mrkev", "jablka"),
        ("citron",),
        ("cukr",),
        (),
        ("zdrave", "vegetarian", "salat", "rychle"),
        ("Mrkev a jablko nastrouhej nahrubo.", "Zakápni citronem a dochuť špetkou cukru."),
    ),
    Recipe(
        "smoothie",
        "Ovocné smoothie",
        "🥤",
        5,
        ("kefir",),
        ("jahody", "jablka", "hrozny", "jogurt-bily"),
        (),
        (),
        ("sladke", "zdrave", "rychle", "snidane"),
        ("Všechno dej do mixéru a rozmixuj dohladka.", "Když je moc husté, přilij trochu kefíru."),
    ),
    Recipe(
        "burger",
        "Domácí burger",
        "🍔",
        30,
        ("mlete-maso",),
        ("syr-eidam", "salat", "rajcata", "cibule", "kecup", "horcice"),
        ("sůl", "pepř"),
        ("hamburgerové bulky",),
        ("burger", "maso", "teple"),
        (
            "Z masa vytvaruj placky, osol a opepři.",
            "Opeč na rozpálené pánvi 3 minuty z každé strany, na konci přidej sýr.",
            "Bulky opeč a obloz zeleninou a omáčkami.",
        ),
    ),
    Recipe(
        "quesadilla",
        "Quesadilla se sýrem a paprikou",
        "🫓",
        15,
        ("tortilly", "syr-eidam"),
        ("paprika", "kureci-prsa", "cibule", "smetana"),
        (),
        (),
        ("mexicke", "rychle"),
        (
            "Na půlku tortilly dej sýr, papriku a případně kuře.",
            "Přelož a opeč na suché pánvi z obou stran.",
            "Nakrájej na trojúhelníky, podávej se zakysanou smetanou.",
        ),
    ),
    Recipe(
        "losos-bowl",
        "Lososová miska s rýží",
        "🍣",
        25,
        ("losos",),
        ("avokado", "okurka", "mrkev", "citron"),
        ("rýže", "sójová omáčka", "sezam"),
        (),
        ("asijske", "sushi", "zdrave", "ryba"),
        (
            "Uvař rýži a nech ji trochu vychladnout.",
            "Lososa opeč nebo použij uzeného.",
            "Do misky dej rýži, lososa, avokádo a zeleninu, zakápni sójovou omáčkou.",
        ),
    ),
    Recipe(
        "palacinky",
        "Palačinky s džemem",
        "🥞",
        25,
        ("mleko", "vejce"),
        ("dzem", "jahody", "tvaroh"),
        ("hladká mouka", "olej"),
        (),
        ("sladke", "vegetarian"),
        (
            "Rozmíchej 2 vejce, 3 dl mléka a 150 g mouky na hladké těstíčko.",
            "Na rozpálené pánvi s kapkou oleje peč tenké palačinky.",
            "Namaž džemem nebo tvarohem a zaroluj.",
        ),
    ),
)

# Chuť (normalizovaný text) -> tagy receptů.
CRAVING_TAGS: dict[str, tuple[str, ...]] = {
    "pizz": ("pizza",),
    "italsk": ("italske",),
    "testovin": ("testoviny",),
    "spaget": ("testoviny",),
    "sladk": ("sladke",),
    "dezert": ("sladke",),
    "palacink": ("sladke",),
    "asijsk": ("asijske",),
    "cinsk": ("asijske",),
    "sushi": ("sushi", "asijske"),
    "ramen": ("asijske",),
    "thai": ("asijske",),
    "burger": ("burger",),
    "mexick": ("mexicke",),
    "burrito": ("mexicke",),
    "taco": ("mexicke",),
    "zdrav": ("zdrave",),
    "lehk": ("zdrave", "salat"),
    "salat": ("salat",),
    "snidan": ("snidane",),
    "rychl": ("rychle",),
    "maso": ("maso",),
    "ryb": ("ryba",),
    "k pivu": ("k-pivu",),
    "tepl": ("teple",),
}


def craving_tags(text: str) -> set[str]:
    norm = normalize(text)
    return {t for needle, tags in CRAVING_TAGS.items() if needle in norm for t in tags}


def _available(items: list[InventoryItem]) -> dict[str, InventoryItem]:
    """Kanonický klíč -> nejdřív končící použitelná položka (bez prošlých a došlých)."""
    out: dict[str, InventoryItem] = {}
    for it in items:
        if it.status in ("expired", "out") or it.quantity <= 0:
            continue
        cur = out.get(it.canonical)
        if cur is None or (it.days_left if it.days_left is not None else 999) < (
            cur.days_left if cur.days_left is not None else 999
        ):
            out[it.canonical] = it
    return out


def _rescue_points(item: InventoryItem) -> int:
    if item.days_left is None:
        return 4
    if item.days_left <= 1:
        return 45
    if item.days_left <= 3:
        return 25
    return 5


def _name(key: str) -> str:
    spec = BY_KEY.get(key)
    return spec.name if spec else key


def builtin_suggestions(
    items: list[InventoryItem],
    *,
    craving: str | None = None,
    prefs: UserPreferences | None = None,
    max_missing: int = 3,
) -> list[RecipeSuggestion]:
    have = _available(items)
    wanted = craving_tags(craving) if craving else set()
    vegetarian = bool(prefs and any("vegetar" in normalize(d) for d in prefs.diet))
    scored: list[tuple[tuple, RecipeSuggestion]] = []
    for r in RECIPES:
        if vegetarian and "vegetarian" not in r.tags:
            continue
        if wanted and not wanted & set(r.tags):
            continue
        used = [have[k] for k in (*r.needs, *r.optional) if k in have]
        missing = [_name(k) for k in r.needs if k not in have] + list(r.buy_extra)
        if len(missing) > max_missing or not used:
            continue
        rescue = min(100, sum(_rescue_points(i) for i in used))
        suggestion = RecipeSuggestion(
            id=r.id,
            title=r.title,
            emoji=r.emoji,
            minutes=r.minutes,
            uses_item_ids=[i.id for i in used],
            uses=[i.name for i in used],
            missing=missing,
            rescue_score=rescue,
            steps=list(r.steps),
            source="frida",
        )
        scored.append(((len(missing), -rescue, -len(used), r.minutes), suggestion))
    scored.sort(key=lambda x: x[0])
    return [s for _, s in scored]


# ----------------------------------------------------------------- Claude
class _IdeaRecipe(BaseModel):
    title: str
    emoji: str
    minutes: int
    uses: list[str]
    missing: list[str]
    steps: list[str]


class _Ideas(BaseModel):
    message: str
    recipes: list[_IdeaRecipe]


RECIPE_SYSTEM = """Jsi Frida, kuchařka chytré lednice v české domácnosti.
Navrhuj jednoduchá domácí jídla z toho, co je v lednici. Pravidla:
- Přednostně použij potraviny, kterým brzy končí trvanlivost (days_left je nízké).
- Nikdy nepoužívej potraviny se stavem "expired".
- `uses` obsahuje přesné názvy položek z lednice (tak, jak jsou v seznamu).
- `missing` obsahuje jen to, co opravdu chybí a je potřeba koupit. Běžné trvanlivé věci (sůl, olej, mouka, těstoviny, rýže, koření) bereme jako doma.
- Kroky stručně, česky, max 5 kroků. Ať to jde přečíst i nahlas.
- Respektuj dietu a alergeny.
- `message`: jedna dvě věty pro uživatele, přátelsky a věcně.
"""


async def claude_suggestions(
    client: AsyncAnthropic,
    settings: Settings,
    items: list[InventoryItem],
    *,
    craving: str | None,
    prefs: UserPreferences | None,
    count: int = 4,
) -> tuple[str, list[RecipeSuggestion]]:
    usable = [i for i in items if i.status not in ("out",) and i.quantity > 0]
    fridge = "\n".join(
        f"- {i.name} | {i.quantity:g} {i.unit} | stav {i.status} | days_left {i.days_left}" for i in usable
    )
    diet = ""
    if prefs:
        diet = (
            f"Dieta: {', '.join(prefs.diet) or 'bez omezení'}. Alergeny: {', '.join(prefs.allergens) or 'žádné'}. "
            f"Domácnost: {prefs.household_size} osoby."
        )
    ask = f"Mám chuť na: {craving}." if craving else "Co uvařit dnes?"
    response = await client.beta.messages.parse(
        **request_kwargs(settings, settings.agent_effort_chat),
        max_tokens=12000,
        system=RECIPE_SYSTEM,
        messages=[
            {
                "role": "user",
                "content": f"V lednici:\n{fridge}\n\n{diet}\n{ask}\nNavrhni {count} recepty, seřaď od nejlepšího. "
                "Aspoň dva ať jdou uvařit bez nakupování.",
            }
        ],
        output_format=_Ideas,
    )
    ideas = response.parsed_output
    if response.stop_reason == "refusal" or ideas is None:
        raise RuntimeError("Recepty se nepodařilo vygenerovat")
    out: list[RecipeSuggestion] = []
    for n, idea in enumerate(ideas.recipes):
        used = [_match_item(name, usable) for name in idea.uses]
        used_items = [u for u in used if u is not None]
        out.append(
            RecipeSuggestion(
                id=f"claude-{n}-{normalize(idea.title).replace(' ', '-')[:40]}",
                title=idea.title,
                emoji=idea.emoji[:4] or "🍳",
                minutes=max(1, idea.minutes),
                uses_item_ids=[u.id for u in used_items],
                uses=[u.name for u in used_items] or idea.uses,
                missing=idea.missing,
                rescue_score=min(100, sum(_rescue_points(u) for u in used_items)),
                steps=idea.steps[:6],
                source="claude",
            )
        )
    return ideas.message, out


def _match_item(name: str, items: list[InventoryItem]) -> InventoryItem | None:
    best, score = None, 0.0
    for it in items:
        s = 1.0 if it.name == name else similarity(name, it.name)
        if s > score:
            best, score = it, s
    return best if score >= 0.5 else None


# ----------------------------------------------------------------- služba
def _builtin_message(recipes: list[RecipeSuggestion]) -> str | None:
    if not recipes:
        return None
    top = recipes[0]
    if top.rescue_score >= 25 and top.uses:
        return (
            f"Nejvíc pomůže {top.title.lower()}. Spotřebuje se: {', '.join(u.lower() for u in top.uses[:2])}."
        )
    if not top.missing:
        return f"Z lednice zvládneš {top.title.lower()} za {top.minutes} minut."
    return f"Na {top.title.lower()} stačí dokoupit {', '.join(top.missing)}."


class RecipeService:
    def __init__(self, settings: Settings, client: AsyncAnthropic | None, delivery: DeliveryProvider) -> None:
        self.settings = settings
        self.client = client
        self.delivery = delivery

    async def suggest(
        self,
        items: list[InventoryItem],
        *,
        craving: str | None = None,
        prefs: UserPreferences | None = None,
        limit: int = 6,
    ) -> tuple[str | None, list[RecipeSuggestion]]:
        if self.client is not None:
            try:
                msg, recipes = await claude_suggestions(
                    self.client, self.settings, items, craving=craving, prefs=prefs
                )
                return msg, recipes[:limit]
            except Exception as exc:
                log.warning("recepty přes Claude selhaly, beru vestavěné: %s", exc)
        recipes = builtin_suggestions(items, craving=craving, prefs=prefs)[:limit]
        # U chuti skládá zprávu craving() (vaření hned, dokoupení, rozvoz).
        return (None if craving else _builtin_message(recipes)), recipes

    async def craving(
        self,
        text: str,
        items: list[InventoryItem],
        *,
        location: GeoPoint,
        prefs: UserPreferences | None = None,
    ) -> CravingAnswer:
        msg, recipes = await self.suggest(items, craving=text, prefs=prefs, limit=8)
        cook_now = [r for r in recipes if not r.missing][:3]
        buy_and_cook = [r for r in recipes if r.missing][:3]
        order_in: list[DeliveryVenue] = await delivery_options(self.delivery, text, location)
        if msg is None:
            cuisine = detect_cuisine(text)
            if cook_now:
                msg = f"Z lednice zvládneš {cook_now[0].title.lower()} za {cook_now[0].minutes} minut."
            elif buy_and_cook:
                msg = (
                    f"Na {buy_and_cook[0].title.lower()} stačí dokoupit {', '.join(buy_and_cook[0].missing)}."
                )
            else:
                msg = "Z toho, co je doma, to neuvaříš."
            if cuisine:
                msg += " Nebo si to nech dovézt, níž jsou odkazy do Woltu a foodory."
        return CravingAnswer(
            craving=text, cook_now=cook_now, buy_and_cook=buy_and_cook, order_in=order_in, message=msg
        )
