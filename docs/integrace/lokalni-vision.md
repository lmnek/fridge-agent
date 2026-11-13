# Lokální rozpoznávání: vision transformery doma, bez cloudu

Stav: 13. 11. 2026. Měřeno na Apple M5 Pro (24 GB, MPS), torch 2.15.0, transformers 5.22.2. Kód je v `backend/frida/vision/local_vit.py`, testy v `backend/tests/test_local_vit.py`.

## Shrnutí

- Frida umí poznat potraviny ve snímku z lednice **lokálně**: najde je, pojmenuje podle katalogu, odhadne polici a zkusí přečíst datum spotřeby.
- Tři modely z rodiny ViT: **OWLv2** najde věci, **SigLIP 2** je pojmenuje, **Florence-2** zkusí přečíst datum.
- Claude je záloha. V kaskádě (`FRIDA_VISION_PROVIDER=cascade`) se snímek pošle Claudovi, jen když má některá detekce jistotu pod `FRIDA_CASCADE_ESCALATE_BELOW` (0,55), když je věc nová nebo když lokální modely nejsou k dispozici.
- Jistota je hlavně signál pro kaskádu. Inventář bere jen detekce s jistotou aspoň 0,45.
- Datum spotřeby z kamery se většinou **nepřečte** (je vysoké 7 až 8 px). To je očekávané. Spolehlivá cesta je „Skenovat datum“ mobilem.

## Instalace

```bash
cd backend
uv sync --extra vision-local --extra reolink
```

Pozor, samotné `uv sync` extra balíčky zase odinstaluje. Žádné další balíčky (scipy, torchvision, timm, einops) nejsou potřeba.

Do `.env`:

```bash
FRIDA_VISION_PROVIDER=cascade        # nebo local (jen lokálně, bez Clauda)
```

Modely se stáhnou při prvním použití do cache Hugging Face (`~/.cache/huggingface/hub`, jinde přes `HF_HOME`). Potom se načítají jen z disku, bez sítě. Frida modely načte na pozadí hned po startu (`warmup()`), takže první snímek nečeká na stažení.

| Stupeň | Model | Stažení |
|---|---|---|
| Detekce | `google/owlv2-base-patch16-ensemble` | 620 MB |
| Klasifikace | `google/siglip2-base-patch16-224` | 1,5 GB |
| Čtení data (volitelné) | `florence-community/Florence-2-base` | 463 MB |
| Celkem | | asi 2,6 GB |

Čtení data je ve výchozím nastavení zapnuté (`FRIDA_LOCAL_VISION_OCR=florence-community/Florence-2-base`). Vypneš ho prázdnou hodnotou nebo `none`.

## Jak to funguje

### 1. Detekce (OWLv2)

- Dotazy jsou anglické popisy z katalogu (`vision_prompts`, např. „a carton of milk“) a pět obecných („a food package“, „a bottle“, „a jar“, „a box“, „a plastic container“). Obecné dotazy zachytí i věci mimo katalog.
- Text se zakóduje jen jednou při načtení. Na každý snímek běží jen obrazová část.
- Snímek se doplní šedou do čtverce a zmenší na 960×960. Předzpracování dělá Frida sama (Pillow a numpy), procesor z transformers by potřeboval scipy nebo torchvision.
- Úklid boxů:
  - práh `FRIDA_LOCAL_DETECTION_THRESHOLD` (0,18) na nejlepší skóre přes všechny dotazy,
  - pryč boxy širší než 55 % snímku, vyšší než 75 % nebo s plochou nad 25 % (police, stěny, celé dveře),
  - NMS bez ohledu na třídu (IoU 0,45),
  - box, který z 80 % leží uvnitř silnějšího boxu, je jeho část (vejce v platu). Části se počítají jako kusy,
  - box, který obsahuje středy dvou a víc jiných boxů, je skupina nebo police a zahodí se.

### 2. Pojmenování (SigLIP 2)

- Každý box se vyřízne s okrajem 6 %, doplní do čtverce a porovná s popisy:
  - „a photo of …“ ze všech `vision_prompts`,
  - `a package labeled "<český název>"` (SigLIP 2 je vícejazyčný a nápis na obalu umí přečíst),
  - pět popisů pozadí (prázdná police, přihrádka ve dveřích, šuplík, stěna, světlo). Když vyhraje pozadí, box se zahodí.
- Detektor přidá slabou nápovědu: klíč, který OWLv2 vybral, nic neztrácí, ostatní klíče dostanou mírnou penalizaci.
- Jistota = pravděpodobnost vybraného klíče (softmax přes celý katalog) × síla detekce `min(1, 0,6 + skóre OWLv2)`.

### 3. Sloučení, počty, police

- Stejné věci těsně vedle sebe se sloučí do jedné detekce (tři jogurty v řadě).
- `quantity` se vyplní **jen u jednotky „ks“ a jen když jsme viděli aspoň dva kusy**. Jinak je `None` a inventář počet nemění. Důvod: inventář při poklesu počtu zapisuje spotřebu, takže „1“ u balení kuřecích prsou (500 g) by každý snímek zapsalo 499 g snědených.
- `fill_level` je vždy `None`. Hladinu v neprůhledné krabici kamera neuvidí.
- Police: kamera s „dveře“ nebo „door“ v názvu dává `door`. Jinak podle svislé polohy středu boxu: do 0,36 `top`, do 0,62 `middle`, do 0,84 `bottom`, níž `drawer`. Je to hrubý odhad, který závisí na tom, kde kamera visí.

### 4. Datum spotřeby (Florence-2, volitelné)

- Úloha `<OCR_WITH_REGION>` najde řádky textu ve výřezu a přečte je. Výřez se bere z plného rozlišení snímku.
- Přeskočí se zelenina a ovoce, výřezy s kratší stranou pod 48 px a věci, které už mají datum z obalu nebo od uživatele.
- Nejdřív maso a ryby, pak uzeniny a mléčné, pak větší výřezy. Na snímek je rozpočet 4 s. Co se nevejde, přijde na řadu příště.
- Stejnou věc na stejné kameře čte nejvýš jednou za 30 minut. Bez toho by OCR běželo na každém snímku a stálo by sekundy.
- Přijetí data je přísné, protože přečtené datum už inventář nepřepíše odhadem:
  - řádek s časem (hh:mm) je razítko kamery, ne obal,
  - datum shodné se dnem pořízení snímku se zahodí (razítko kamery),
  - bez klíčového slova („spotřebujte do“, „DMT“…) se bere jen celé datum dd.mm.rrrr.

## Proč tyhle modely

- **OWLv2** hledá podle libovolného textu, je přímo v transformers a boxy sedí velmi dobře (na demu většinou IoU 0,8 až 0,95). Názvy podle obecných dotazů ale neurčí, proto druhý stupeň.
- **SigLIP 2** na výřezech: jen s anglickými popisy byla úspěšnost na správných výřezech 0,43, s českým názvem z obalu 0,63.
- **Florence-2 místo TrOCR**: TrOCR čte jen jeden předem vyříznutý řádek. Na výřezu celé krabice vrátil „ML50“, na vyříznutém řádku přečetl datum správně. Frida ale nemá detektor řádků. Florence-2 řádky najde i přečte sám, je menší (463 MB proti 1,33 GB) a rychlejší. Verze `florence-community/Florence-2-base` běží v transformers 5 nativně, bez `trust_remote_code`. Původní `microsoft/Florence-2-base` je psaný pro vzdálený kód a Frida ho nepodporuje, použij verzi z `florence-community`.

## Naměřeno na demo snímcích

Demo kamera kreslí ploché ilustrace, ne fotky. Čísla jsou kouřový test, ne benchmark. Skóruje se shoda kanonického klíče a IoU aspoň 0,3 proti `ground_truth` (provider ho nikdy nedostane, test to hlídá). Dvě kamery, 30 věcí (police 18, dveře 12).

| | práh 0,18 (výchozí) | práh 0,10 |
|---|---|---|
| Lokalizace (nějaký box s IoU ≥ 0,3) | 0,80 | 0,87 |
| Přesnost / úplnost, všechny detekce | 0,75 / 0,60 | 0,73 / 0,63 |
| Přesnost / úplnost, jistota ≥ 0,45 (bere inventář) | 0,89 / 0,53 | 0,89 / 0,53 |
| Přesnost / úplnost, jistota ≥ 0,55 (bez Clauda) | 1,00 / 0,53 | 1,00 / 0,53 |
| Vymyšlená data spotřeby | 0 | 0 |

- Dveře: 9 z 12 správně, police: 9 z 18.
- Kreslená zelenina a ovoce (barevné kruhy) mají v OWLv2 skóre jen 0,08 až 0,11, takže při prahu 0,18 vypadnou. Při 0,10 se najdou, ale SigLIP je pojmenuje špatně (kruhy vypadají jako vejce nebo cibule). Na skutečných fotkách to bude jiné, práh se proto kvůli demu neladil.
- Obaly s nejasným nápisem (jogurt „BÍLÝ“, zbytky, eidam, kuřecí) dostanou nízkou jistotu a kaskáda je pošle Claudovi. Všechny špatné názvy skončily pod 0,55.
- Co to znamená v provozu:
  - V kaskádě má každý demo snímek aspoň jednu detekci pod 0,55 (toustový chléb 0,23, mléko 0,51), takže každý půjde i Claudovi. Na demu lokální stupeň zatím Claudovi volání neušetří.
  - V režimu `local` (bez Clauda) se do inventáře dostanou dvě špatné položky s jistotou mezi 0,45 a 0,55: minerálka místo mléka a „vejce, 2 ks“ místo citronů.
  - Další krok je kalibrace prahu a jistoty na skutečných snímcích z B310.
- CPU i MPS dávají stejné výsledky.

| Čas | MPS (M5 Pro) | CPU (M5 Pro) |
|---|---|---|
| Načtení a zahřátí, modely v cache | 6 až 14 s | asi 10 s |
| Detekce | 0,26 s | 1,2 s |
| Pojmenování 11 až 13 výřezů | 0,11 s | 0,5 s |
| Snímek bez OCR | 0,37 s | 1,7 s |
| OCR jednoho výřezu | 0,2 až 0,35 s | asi 1 s |
| První snímek s OCR | asi 2,5 s | 5 až 7 s (OCR stihne 3 výřezy, zbytek příště) |

Měřeno na nezatíženém stroji. Když na Macu běželo souběžně něco dalšího, časy na MPS vyšly až dvakrát delší (snímek bez OCR 0,7 až 0,9 s).

## Co čekat od čtení data

- B310 má 2304×1296 a 88° záběr. Na 40 cm to je asi 3 px na milimetr, takže 2,5 mm vysoké datum má 7 až 8 px (výpočet v [reolink-kamera.md](reolink-kamera.md)).
- Na čistém syntetickém štítku Florence-2 přečte datum i při 6 px. Na skutečném obalu ale bude lesklá fólie, zakřivení, rozostření, šikmý pohled a datum často na víčku nebo zezadu. Většinou se tedy nepřečte nic a inventář dopočítá expiraci z katalogu (`estimated`).
- Test `test_florence_reads_printed_date` ověřuje, že datum velké 11 až 13 px na demo krabici mléka se přečte správně.

## Nastavení

| Proměnná | Výchozí | K čemu |
|---|---|---|
| `FRIDA_VISION_PROVIDER` | `auto` | `local` jen lokálně, `cascade` lokálně a Claude pro nejisté |
| `FRIDA_LOCAL_VISION_DEVICE` | `auto` | `auto` zkouší CUDA, pak MPS, pak CPU. Jde vynutit `cpu`, `mps`, `cuda` |
| `FRIDA_LOCAL_VISION_DETECTOR` | `google/owlv2-base-patch16-ensemble` | detektor OWLv2 |
| `FRIDA_LOCAL_VISION_CLASSIFIER` | `google/siglip2-base-patch16-224` | klasifikátor SigLIP |
| `FRIDA_LOCAL_VISION_OCR` | `florence-community/Florence-2-base` | prázdné nebo `none` OCR vypne. TrOCR není podporovaný (vypne OCR s varováním) |
| `FRIDA_LOCAL_DETECTION_THRESHOLD` | `0.18` | nižší najde víc věcí, ale i víc smetí |
| `FRIDA_CASCADE_ESCALATE_BELOW` | `0.55` | pod touto jistotou kaskáda volá Clauda |

## Když něco chybí

- **Chybí torch nebo transformers**: `VisionUnavailable` se zprávou „Lokální vision potřebuje PyTorch a transformers (chybí torch). Nainstaluj: uv sync --extra vision-local --extra reolink“. Kaskáda přejde na Clauda, jinak se v pozorování objeví „Rozpoznávání nedostupné“.
- **Model se nestáhne** (síť, špatný název): taky `VisionUnavailable`. Další pokus o načtení až za 5 minut, aby se nestahovalo s každým snímkem.
- **OCR model se nenačte**: jen varování v logu, rozpoznávání jede dál bez čtení dat.
- Modely se načtou jednou a drží se v paměti. Zámek hlídá, aby se nenačítaly dvakrát a aby dvě kamery nepoužívaly model ve stejnou chvíli. Výpočet běží v samostatném vlákně (`asyncio.to_thread`), takže neblokuje server.

## Testy

```bash
cd backend
uv run --extra vision-local --extra reolink pytest tests/test_local_vit.py
```

13 testů, na M5 Pro asi 15 s. Bez torch nebo bez modelů v cache se těžké testy přeskočí a běží jen ty rychlé (import bez torch, chybová hláška, výběr data, úklid boxů, slučování).

## Známá omezení

- Ověřeno jen na demo ilustracích. Práh a jistotu je potřeba doladit na skutečných snímcích z B310 (stačí pár desítek fotek s ručně označenými věcmi).
- Police je odhad podle polohy ve snímku. Při jinak zavěšené kameře hranice nesedí.
- Pravidlo „box se středy dvou a víc jiných boxů je skupina“ může zahodit velkou věc, před kterou stojí dvě menší (hrnec a před ním dva jogurty).
- Datum pořízení pro kontrolu razítka kamery se počítá v `FRIDA_TIMEZONE`, protože razítko je v místním čase.
- Cesta pro CUDA (float16) je napsaná, ale nevyzkoušená. Měřeno jen MPS a CPU.
- Počty jsou jen viděné kusy. Zakrytý kus znamená menší počet, a tím zápis spotřeby. Proto jen u „ks“ a od dvou kusů.
- Věc mimo katalog se pojmenuje nejbližším klíčem s nízkou jistotou, takže ji kaskáda pošle Claudovi.
- Každý snímek se vyhodnocuje samostatně, bez sledování věcí v čase.
- Výřezy pro SigLIP se nedoplňují podle prvního slova z demo nápisu. Na demu by to zvedlo úspěšnost, ale byl by to fígl na kreslenou scénu, ne na skutečné obaly.
