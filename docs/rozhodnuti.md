# Architektura a rozhodnutí

## Celkový obraz

```text
 Reolink Home Hub ──(HTTP API, push události)──┐
   2× Argus B310                               │
                                               ▼
 dveřní senzor ──POST /api/camera/trigger──► CameraManager ──snímek──► VisionPipeline
                                               │                       │  jas + barevná změna (bez AI)
                                               │                       │  mock | Claude | lokální ViT | kaskáda
                                               ▼                       ▼
                                          EventLog ◄──────────── InventoryService (párování, spotřeba, trvanlivost)
                                               │
                         ┌─────────────────────┼──────────────────────────┐
                         ▼                     ▼                          ▼
              NotificationService       EventBus (/ws)            AgentBrain (Claude)
          push · hovor · SMS · souhrn    živé UI v prohlížeči      nástroje: inventář, akce, plán nákupu,
                         │                                         Rohlík, recepty, rozvoz, kamera, hovor
                         ▼                                                  │
                VoiceService (Twilio) ◄──ConversationRelay WS──────────────┘
```

## Rozhodnutí

**Demo režim jako výchozí.** Každá integrace má simulaci, která se zapne sama, když chybí klíč. Aplikace tak jde vyzkoušet hned po spuštění a skutečné služby se připojují postupně, každá zvlášť a s vlastním testem z terminálu. Simulovaná lednice se vykresluje jako obrázek a prochází stejnou cestou jako snímek ze skutečné kamery (změna obrazu, rozpoznání, párování s inventářem).

**Kamera snímá jen při události.** Argus B310 jsou bateriové kamery: každé probuzení stojí baterii a živý náhled trvá max. 5 minut. Snímek se proto pořizuje po otevření dveří (s krátkou pauzou, než se rozsvítí), pak několik dalších, dokud jsou dveře otevřené. Snímky beze změny a za tmy se nerozpoznávají, což u Claude šetří peníze.

**Inventář neodebírá věci, které model jen přehlédl.** Položka zmizí jen tehdy, když na jejím místě byla vidět změna, nebo když chybí dvakrát po sobě. Základní potraviny (mléko, vejce, máslo…) se při spotřebování neodstraní, zůstanou jako „došlo“ a jdou do nákupu.

**Datum spotřeby čte hlavně mobil.** Z kamery v lednici je datum na obalu vysoké jen 7 až 8 pixelů. Frida ho zkusí přečíst, ale spolehlivá cesta je funkce „Skenovat datum“ (fotka etikety nebo čárový kód). Když datum chybí, odhadne se podle druhu potraviny.

**Lokální vision transformery a Claude v kaskádě.** OWLv2 (najde věci podle popisu), SigLIP 2 (pojmenuje je podle katalogu) a Florence-2 (zkusí přečíst text) běží doma. Claude se zavolá jen u nejistých nebo nových věcí. Jde to přepnout na čistě lokální, čistě Claude nebo mock.

**Agent s vlastní smyčkou.** Streamuje text do UI i do telefonu, nástroje z jedné odpovědi pouští paralelně a výsledky vrací v jedné zprávě. Historie konverzace se jen přidává (thinking bloky se vrací beze změny), aktuální stav lednice jde jako systémová zpráva za otázkou, takže se neruší cache ani zachovaný thinking. Bez klíče odpovídá jednoduchý pravidlový agent nad stejnými nástroji.

**Nákup končí u člověka.** Košík v Rohlíku Frida naplní, ale objednávku nikdy neodešle. Nástroje Rohlík MCP na rušení objednávek, reklamace a mazání košíku jsou zablokované v kódu. Platba a potvrzení jsou vždy na tobě v aplikaci nebo na webu Rohlíku.

**Akce z webů s akcemi, ne z letáků.** akcniceny.cz je výchozí (strukturovaná data, volný robots.txt), kupi.cz je volitelné kvůli pravidlu pro AI v robots.txt. Plán nákupu počítá i cestu: každá zastávka navíc stojí 25 Kč a kilometr 8 Kč, kombinace obchodů se procházejí přesně, ne heuristikou. Frida si pamatuje historii cen a řekne, jestli je cena dobrá.

**Rozvoz bez scrapování.** Podmínky Woltu (§13.6) zakazují automatický sběr dat, proto Frida jen otevře hledání v aplikaci Wolt nebo foodora. Rozhraní pro partnerské API je připravené.

**Telefon přes Twilio ConversationRelay.** Twilio dělá převod řeči (Deepgram cs-CZ) a hlas (ElevenLabs), mozkem je pořád stejný agent s nástroji. Pojistky převzaté jako myšlenka z AI Volavky: allowlist čísel, limity hovorů, tiché hodiny, maximální délka hlídaná serverem, nástroj na zavěšení. Navíc kontrola podpisu Twilia a detekce záznamníku.

**Úložiště je SQLite jako dokumentová databáze.** Jedna tabulka `docs(collection, id, ts, data)`, časy vždy v UTC. Pro domácnost víc než stačí, záloha je jeden soubor.

**Žádné AWS, žádný kód z jiných projektů.** Frida je samostatný projekt. AI Volavka posloužila jen jako inspirace pro bezpečnostní pojistky hovorů, kód je napsaný od nuly.

## Rozšíření, která dávají smysl

- Váha nebo chytrá podložka pod mléko a nápoje (hladinu v neprůhledné krabici kamera nevidí).
- Dveřní kontakt pro spolehlivé spouštění snímků.
- Import tabulek trvanlivosti USDA FoodKeeper pro lepší odhad expirace.
- Partnerský přístup k rozvozu jídla.
- Přihlašování do aplikace, pokud má být dostupná mimo domácí síť (zatím řeší Cloudflare Access).
