# Frida, webové rozhraní

React 19, Vite, TypeScript a Tailwind v4. Všechna data bere z backendu v `../backend`.

## Vývoj

Nejdřív spusť backend (výchozí adresa je `http://127.0.0.1:8000`). Pak:

```bash
npm install
npm run dev
```

Aplikace poběží na http://localhost:5173. Vite přeposílá `/api`, `/ws`, `/voice` a `/healthz` na backend.
Když backend běží jinde, nastav `VITE_BACKEND`:

```bash
VITE_BACKEND=http://127.0.0.1:8765 npm run dev
```

## Build

```bash
npm run build
```

Spustí kontrolu typů a výsledek uloží do `dist/`. Když `dist/` existuje při startu backendu, backend ho servíruje sám na své adrese, takže stačí jeden proces.

## Poznámky

- Hlas (rozpoznávání i čtení nahlas) používá Web Speech API prohlížeče. Nejlíp funguje v Chrome a Safari.
- Kamera pro skenování data a čárové kódy potřebuje HTTPS nebo localhost.
- Frida nikdy sama neobjednává. Košík v Rohlíku se dokončuje v Rohlíku.
