"""Znalostní báze potravin, které se běžně objevují v české lednici.

Slouží k:
- převodu toho, co model uviděl, na kanonický klíč ("mleko"),
- odhadu expirace, když na obalu není vidět datum (trvanlivost je orientační,
  inspirovaná tabulkami typu USDA FoodKeeper, vždy přednost má datum z obalu),
- dotazům pro open-vocabulary detektor (OWLv2 chce anglické popisy),
- vykreslení demo scény (tvar a barva obalu).

Hodnoty `typical_price_czk` jsou orientační ceny pro demo a pro odhad, kolik
peněz se vyhodilo. Skutečné ceny se berou z akcí a z Rohlíku.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from ..schemas import Category, Shelf, Unit
from ..text import normalize, similarity

Shape = str  # bottle | carton | jar | box | tub | pack | round | bunch | eggs | can | bag | block


@dataclass(frozen=True)
class FoodSpec:
    key: str
    name: str
    emoji: str
    category: Category
    unit: Unit = "ks"
    default_qty: float = 1
    shelf_days: int = 7  # neotevřené v lednici
    opened_days: int | None = None  # po otevření
    typical_price_czk: float = 40
    staple: bool = False
    min_quantity: float = 0
    shelf: Shelf = "middle"
    synonyms: tuple[str, ...] = ()
    vision_prompts: tuple[str, ...] = ()  # anglické dotazy pro OWLv2/SigLIP
    shape: Shape = "box"
    color: str = "#9aa4b2"
    search_query: str = ""  # co hledat v Rohlíku a v akcích
    extra: dict[str, str] = field(default_factory=dict)

    @property
    def query(self) -> str:
        return self.search_query or self.name


CATALOG: tuple[FoodSpec, ...] = (
    # --- mléčné ------------------------------------------------------------
    FoodSpec("mleko", "Mléko polotučné", "🥛", "dairy", "l", 1, 10, 4, 25, True, 1, "door",
             ("mleko", "mlicko", "milk", "trvanlive mleko", "cerstve mleko"),
             ("a carton of milk", "a bottle of milk"), "carton", "#f4f7fb", "mléko polotučné 1 l"),
    FoodSpec("jogurt-bily", "Bílý jogurt", "🥣", "dairy", "ks", 2, 14, 3, 18, True, 1, "middle",
             ("jogurt", "bily jogurt", "recky jogurt", "yogurt"),
             ("a cup of yogurt", "a yogurt container"), "tub", "#e9f1ff", "bílý jogurt"),
    FoodSpec("maslo", "Máslo", "🧈", "dairy", "ks", 1, 30, 14, 55, True, 1, "door",
             ("maslo", "butter"), ("a block of butter",), "block", "#f6d66b", "máslo 250 g"),
    FoodSpec("smetana", "Smetana na vaření", "🥛", "dairy", "ks", 1, 14, 3, 30, False, 0, "middle",
             ("smetana", "smetana na vareni", "slehacka", "cream"), ("a carton of cream",), "carton", "#fdf3e1",
             "smetana na vaření 12 %"),
    FoodSpec("tvaroh", "Tvaroh", "🥣", "dairy", "ks", 1, 10, 3, 32, False, 0, "middle",
             ("tvaroh", "quark", "cottage cheese"), ("a tub of quark",), "tub", "#ffffff", "tvaroh měkký"),
    FoodSpec("kefir", "Kefír", "🥛", "dairy", "ks", 1, 14, 3, 28, False, 0, "door",
             ("kefir", "acidofilni mleko", "zakys"), ("a bottle of kefir",), "bottle", "#eef6ff", "kefír"),
    # --- sýry --------------------------------------------------------------
    FoodSpec("syr-eidam", "Eidam plátky", "🧀", "cheese", "bal", 1, 21, 7, 45, True, 1, "middle",
             ("eidam", "syr platky", "gouda", "sýr", "cheese slices"), ("a pack of sliced cheese",), "pack",
             "#ffd86b", "eidam 30 % plátky"),
    FoodSpec("mozzarella", "Mozzarella", "🧀", "cheese", "ks", 1, 14, 3, 30, False, 0, "middle",
             ("mozzarella",), ("a bag of mozzarella",), "bag", "#f8fbff", "mozzarella"),
    FoodSpec("parmezan", "Parmazán", "🧀", "cheese", "ks", 1, 60, 30, 89, False, 0, "middle",
             ("parmazan", "grana padano", "parmesan"), ("a wedge of parmesan cheese",), "block", "#f3d27a",
             "parmazán"),
    FoodSpec("hermelin", "Hermelín", "🧀", "cheese", "ks", 1, 21, 5, 35, False, 0, "middle",
             ("hermelin", "camembert", "brie"), ("a round box of camembert",), "round", "#fbf6ea", "hermelín"),
    # --- vejce -------------------------------------------------------------
    FoodSpec("vejce", "Vejce", "🥚", "eggs", "ks", 10, 28, None, 45, True, 4, "middle",
             ("vejce", "vajicka", "eggs"), ("an egg carton", "eggs"), "eggs", "#f2e3c9", "vejce M 10 ks"),
    # --- maso a ryby -------------------------------------------------------
    FoodSpec("kureci-prsa", "Kuřecí prsa", "🍗", "meat", "g", 500, 3, None, 129, False, 0, "bottom",
             ("kureci prsa", "kure", "kureci maso", "chicken breast"), ("a package of raw chicken breast",), "pack",
             "#f7c6c0", "kuřecí prsní řízky"),
    FoodSpec("mlete-maso", "Mleté maso", "🥩", "meat", "g", 500, 2, None, 99, False, 0, "bottom",
             ("mlete maso", "mlete hovezi", "minced meat"), ("a package of ground meat",), "pack", "#d9534f",
             "mleté maso hovězí"),
    FoodSpec("sunka", "Šunka", "🥓", "deli", "bal", 1, 10, 3, 39, True, 1, "middle",
             ("sunka", "sunka nejvyssi jakosti", "ham"), ("a pack of sliced ham",), "pack", "#f4a7b0",
             "šunka nejvyšší jakosti"),
    FoodSpec("salam", "Salám", "🥓", "deli", "bal", 1, 21, 7, 45, False, 0, "middle",
             ("salam", "vysocina", "chorizo", "salami"), ("a pack of salami",), "pack", "#c0392b", "salám"),
    FoodSpec("parky", "Párky", "🌭", "deli", "bal", 1, 14, 3, 49, False, 0, "middle",
             ("parky", "vurty", "sausages"), ("a pack of sausages",), "pack", "#e59866", "párky"),
    FoodSpec("losos", "Losos", "🐟", "fish", "g", 250, 2, None, 159, False, 0, "bottom",
             ("losos", "salmon", "uzeny losos"), ("a package of salmon fillet",), "pack", "#fa8072", "losos filet"),
    # --- zelenina ----------------------------------------------------------
    FoodSpec("rajcata", "Rajčata", "🍅", "vegetables", "ks", 4, 7, None, 35, True, 2, "drawer",
             ("rajce", "rajcata", "cherry rajcata", "tomato"), ("a tomato", "tomatoes"), "round", "#e74c3c",
             "rajčata"),
    FoodSpec("okurka", "Okurka salátová", "🥒", "vegetables", "ks", 1, 7, None, 19, False, 0, "drawer",
             ("okurka", "cucumber"), ("a cucumber",), "bunch", "#27ae60", "okurka salátová"),
    FoodSpec("paprika", "Paprika", "🫑", "vegetables", "ks", 2, 10, None, 25, False, 0, "drawer",
             ("paprika", "bell pepper"), ("a bell pepper",), "round", "#f39c12", "paprika červená"),
    FoodSpec("mrkev", "Mrkev", "🥕", "vegetables", "g", 500, 21, None, 15, False, 0, "drawer",
             ("mrkev", "carrot"), ("carrots",), "bunch", "#e67e22", "mrkev"),
    FoodSpec("salat", "Ledový salát", "🥬", "vegetables", "ks", 1, 6, None, 29, False, 0, "drawer",
             ("salat", "ledovy salat", "rukola", "spenat", "lettuce"), ("a head of lettuce", "salad leaves"),
             "round", "#58d68d", "ledový salát"),
    FoodSpec("cibule", "Cibule", "🧅", "vegetables", "ks", 3, 30, None, 12, True, 1, "drawer",
             ("cibule", "onion"), ("an onion",), "round", "#d4a373", "cibule"),
    FoodSpec("cesnek", "Česnek", "🧄", "vegetables", "ks", 1, 60, None, 15, True, 1, "door",
             ("cesnek", "garlic"), ("a garlic bulb",), "round", "#f5f0e1", "česnek"),
    FoodSpec("zampiony", "Žampiony", "🍄", "vegetables", "g", 250, 5, None, 39, False, 0, "drawer",
             ("zampiony", "houby", "mushrooms"), ("a box of mushrooms",), "box", "#d7ccc8", "žampiony"),
    FoodSpec("brokolice", "Brokolice", "🥦", "vegetables", "ks", 1, 6, None, 35, False, 0, "drawer",
             ("brokolice", "broccoli"), ("a head of broccoli",), "round", "#1e8449", "brokolice"),
    FoodSpec("avokado", "Avokádo", "🥑", "fruit", "ks", 2, 5, 1, 25, False, 0, "drawer",
             ("avokado", "avocado"), ("an avocado",), "round", "#6b8e23", "avokádo"),
    # --- ovoce -------------------------------------------------------------
    FoodSpec("jablka", "Jablka", "🍎", "fruit", "ks", 4, 30, None, 35, True, 2, "drawer",
             ("jablko", "jablka", "apple"), ("an apple",), "round", "#c0392b", "jablka"),
    FoodSpec("citron", "Citron", "🍋", "fruit", "ks", 2, 21, 5, 12, False, 0, "door",
             ("citron", "limetka", "lemon"), ("a lemon",), "round", "#f7dc6f", "citrony"),
    FoodSpec("jahody", "Jahody", "🍓", "fruit", "g", 250, 3, None, 59, False, 0, "middle",
             ("jahody", "boruvky", "maliny", "berries"), ("a box of strawberries",), "box", "#e74c3c", "jahody"),
    FoodSpec("hrozny", "Hroznové víno", "🍇", "fruit", "g", 500, 7, None, 59, False, 0, "drawer",
             ("hrozny", "hroznove vino", "grapes"), ("grapes",), "bunch", "#8e44ad", "hroznové víno"),
    # --- pečivo ------------------------------------------------------------
    FoodSpec("toustovy-chleb", "Toustový chléb", "🍞", "bakery", "bal", 1, 7, 4, 35, False, 0, "top",
             ("toust", "toustovy chleb", "chleba", "chleb", "bread"), ("a bag of sliced bread",), "bag", "#e0b97a",
             "toustový chléb"),
    FoodSpec("tortilly", "Tortilly", "🌯", "bakery", "bal", 1, 14, 5, 39, False, 0, "top",
             ("tortilla", "tortilly", "wraps"), ("a pack of tortillas",), "pack", "#f0d9a7", "tortilly"),
    # --- nápoje ------------------------------------------------------------
    FoodSpec("dzus", "Pomerančový džus", "🧃", "drinks", "l", 1, 21, 5, 39, False, 0, "door",
             ("dzus", "pomerancovy dzus", "juice"), ("a carton of orange juice",), "carton", "#f5a623",
             "pomerančový džus 100 %"),
    FoodSpec("pivo", "Pivo", "🍺", "drinks", "ks", 4, 120, 1, 25, False, 0, "bottom",
             ("pivo", "lahvace", "plechovka piva", "beer"), ("a can of beer", "a beer bottle"), "can", "#d4ac0d",
             "pivo plechovka"),
    FoodSpec("minerálka", "Minerální voda", "💧", "drinks", "l", 1.5, 365, 3, 15, False, 0, "door",
             ("voda", "mineralka", "perliva voda", "water"), ("a bottle of water",), "bottle", "#aed6f1",
             "minerální voda perlivá"),
    FoodSpec("bile-vino", "Bílé víno", "🍾", "drinks", "ks", 1, 365, 3, 129, False, 0, "door",
             ("vino", "bile vino", "wine"), ("a bottle of white wine",), "bottle", "#d5e8a3", "bílé víno"),
    # --- hotová jídla a ostatní --------------------------------------------
    FoodSpec("hummus", "Hummus", "🫙", "ready_meals", "ks", 1, 14, 4, 45, False, 0, "middle",
             ("hummus", "pomazanka"), ("a tub of hummus",), "tub", "#e8c39e", "hummus"),
    FoodSpec("zbytky-jidla", "Zbytky jídla (krabička)", "🍱", "ready_meals", "ks", 1, 3, None, 0, False, 0,
             "middle", ("krabicka", "zbytky", "leftovers"), ("a food container with leftovers",), "box", "#7fb3d5",
             "hotové jídlo"),
    FoodSpec("kecup", "Kečup", "🥫", "condiments", "ks", 1, 180, 60, 45, True, 1, "door",
             ("kecup", "ketchup"), ("a ketchup bottle",), "bottle", "#c0392b", "kečup"),
    FoodSpec("horcice", "Hořčice", "🫙", "condiments", "ks", 1, 180, 60, 25, False, 0, "door",
             ("horcice", "mustard"), ("a mustard jar",), "jar", "#f1c40f", "hořčice plnotučná"),
    FoodSpec("majoneza", "Majonéza", "🫙", "condiments", "ks", 1, 90, 30, 39, False, 0, "door",
             ("majoneza", "tatarka", "mayonnaise"), ("a jar of mayonnaise",), "jar", "#fdfefe", "majonéza"),
    FoodSpec("dzem", "Džem", "🍓", "condiments", "ks", 1, 120, 30, 49, False, 0, "door",
             ("dzem", "marmelada", "jam"), ("a jar of jam",), "jar", "#922b21", "džem jahodový"),
    FoodSpec("pesto", "Pesto", "🌿", "condiments", "ks", 1, 120, 7, 69, False, 0, "door",
             ("pesto",), ("a jar of pesto",), "jar", "#4d7c0f", "pesto bazalkové"),
)

BY_KEY: dict[str, FoodSpec] = {spec.key: spec for spec in CATALOG}


def find_spec(text: str, *, threshold: float = 0.55) -> FoodSpec | None:
    """Najde nejlépe odpovídající položku katalogu pro volný text (český i anglický)."""
    if not text:
        return None
    key = normalize(text)
    if key.replace(" ", "-") in BY_KEY:
        return BY_KEY[key.replace(" ", "-")]
    best: tuple[float, FoodSpec | None] = (0.0, None)
    for spec in CATALOG:
        candidates = (spec.name, spec.key.replace("-", " "), *spec.synonyms, *spec.vision_prompts)
        score = max(similarity(text, c) for c in candidates)
        if score > best[0]:
            best = (score, spec)
    return best[1] if best[0] >= threshold else None


def canonical_for(text: str) -> str:
    spec = find_spec(text)
    if spec:
        return spec.key
    return "-".join(normalize(text).split()[:3]) or "nezname"


def estimate_expiry(spec: FoodSpec | None, *, added: date, opened: bool = False) -> date | None:
    if spec is None:
        return None
    days = spec.opened_days if (opened and spec.opened_days) else spec.shelf_days
    return added + timedelta(days=days)


def all_vision_prompts() -> list[tuple[str, str]]:
    """Seznam (anglický dotaz, kanonický klíč) pro open-vocabulary detektor."""
    out: list[tuple[str, str]] = []
    for spec in CATALOG:
        for prompt in spec.vision_prompts:
            out.append((prompt, spec.key))
    return out
