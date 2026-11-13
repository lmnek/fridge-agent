import { useEffect, useState } from "react";
import { LocateFixed, MapPin, Minus, Plus } from "lucide-react";
import { api } from "../../lib/api";
import type { GeoPoint, UserPreferences, UserPreferencesUpdate } from "../../lib/types";
import { chainStyle } from "../../lib/chains";
import { cx, plural } from "../../lib/format";
import { useApp } from "../../store/app";
import { Field, Panel, SectionTitle, Toggle } from "../../ui/bits";
import { Button, IconButton } from "../../ui/Button";

type Save = (patch: UserPreferencesUpdate) => Promise<void>;

const SOURCE: Record<GeoPoint["source"], string> = {
  browser: "z prohlížeče",
  config: "výchozí ze serveru",
  ip: "odhad podle IP adresy",
  manual: "zadaná ručně",
};

const GEO_ERRORS: Record<number, string> = {
  1: "Prohlížeč polohu nepovolil. Povol ji v nastavení stránky, jinak zůstane ta současná.",
  2: "Polohu se nepodařilo zjistit. Zkus to venku nebo se zapnutou Wi-Fi.",
  3: "Zjišťování polohy trvalo moc dlouho. Zkus to znovu.",
};

export function LocationPanel({ prefs, onChange }: { prefs: UserPreferences; onChange: (loc: GeoPoint) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loc = prefs.location;

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setError("Tenhle prohlížeč polohu zjistit neumí.");
      return;
    }
    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const point = await api.setLocation({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            label: null,
            source: "browser",
          });
          onChange(point);
          useApp.getState().toast({
            title: "Poloha uložená",
            body: point.label ?? "Obchody a rozvoz teď počítám od tebe.",
            tone: "success",
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : "Polohu se nepodařilo uložit.");
        } finally {
          setBusy(false);
        }
      },
      (err) => {
        setError(GEO_ERRORS[err.code] ?? "Polohu se nepodařilo zjistit.");
        setBusy(false);
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 },
    );
  };

  return (
    <Panel aria-labelledby="location">
      <SectionTitle id="location">Poloha</SectionTitle>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/[0.06] text-glacier" aria-hidden>
          <MapPin className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] text-frost">{loc.label ?? "Bez názvu"}</p>
          <p className="tabular text-xs text-mist">
            {loc.lat.toFixed(4)}, {loc.lon.toFixed(4)}
          </p>
          <p className="text-xs text-haze">Poloha je {SOURCE[loc.source]}.</p>
        </div>
      </div>
      <p className="mt-3 text-sm text-mist">Podle ní hledám nejbližší obchody, akce v okolí a rozvoz jídla.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="glass" icon={<LocateFixed className="size-4" aria-hidden />} busy={busy} onClick={locate}>
          Použít moji polohu
        </Button>
        {error && (
          <p className="text-sm text-apricot" role="alert">
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}

const CHAINS = ["Albert", "Lidl", "Billa", "Kaufland", "Penny", "Tesco", "Globus"];

export function ChainsPanel({ prefs, save }: { prefs: UserPreferences; save: Save }) {
  const selected = new Set(prefs.favorite_chains);
  const all = Array.from(new Set([...CHAINS, ...prefs.favorite_chains]));
  const toggle = (chain: string) => {
    const next = selected.has(chain) ? prefs.favorite_chains.filter((c) => c !== chain) : [...prefs.favorite_chains, chain];
    void save({ favorite_chains: next });
  };
  return (
    <Panel aria-labelledby="chains">
      <SectionTitle id="chains">Obchody, kam chodíš</SectionTitle>
      <p className="-mt-1 mb-4 text-sm text-mist">Akce a nákupní plán počítám jen s nimi.</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Oblíbené řetězce">
        {all.map((chain) => {
          const on = selected.has(chain);
          const s = chainStyle(chain);
          return (
            <button
              key={chain}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(chain)}
              className={cx(
                "inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-sm transition-colors",
                on ? "bg-frost/[0.1] text-frost shadow-[inset_0_0_0_1px_rgb(221_239_247/0.25)]" : "frost-chip text-haze hover:text-mist",
              )}
            >
              <span
                className={cx("size-2.5 rounded-full transition-opacity", on ? "opacity-100" : "opacity-35")}
                style={{ background: s.dot }}
                aria-hidden
              />
              {chain}
            </button>
          );
        })}
      </div>
      {selected.size === 0 && <p className="mt-3 text-sm text-apricot">Bez vybraného obchodu hledám akce všude.</p>}
    </Panel>
  );
}

const DIETS = ["vegetariánská", "veganská", "bez lepku", "bez laktózy", "bez vepřového", "nízkosacharidová"];
const ALLERGENS = ["lepek", "mléko", "vejce", "ořechy", "arašídy", "sója", "ryby", "korýši", "celer", "hořčice", "sezam"];

function TogglePills({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const set = new Set(value);
  const all = Array.from(new Set([...options, ...value]));
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {all.map((o) => {
        const on = set.has(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
            className={cx(
              "h-8 rounded-full px-3 text-[13px] transition-colors",
              on ? "bg-glacier/15 text-glacier shadow-[inset_0_0_0_1px_rgb(110_240_216/0.35)]" : "frost-chip text-mist hover:text-frost",
            )}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function FoodPrefsPanel({ prefs, save }: { prefs: UserPreferences; save: Save }) {
  const [budget, setBudget] = useState(prefs.budget_week_czk?.toString() ?? "");
  useEffect(() => setBudget(prefs.budget_week_czk?.toString() ?? ""), [prefs.budget_week_czk]);
  const size = prefs.household_size;

  const commitBudget = () => {
    const trimmed = budget.trim();
    const value = trimmed === "" ? null : Math.max(0, Math.round(Number(trimmed.replace(/\s/g, "").replace(",", "."))));
    if (value !== null && Number.isNaN(value)) {
      setBudget(prefs.budget_week_czk?.toString() ?? "");
      return;
    }
    if (value === prefs.budget_week_czk) return;
    void save({ budget_week_czk: value });
  };

  return (
    <Panel aria-labelledby="food-prefs">
      <SectionTitle id="food-prefs">Jídlo a domácnost</SectionTitle>
      <div className="space-y-5">
        <div>
          <h3 className="mb-2 text-xs text-mist">Strava</h3>
          <TogglePills label="Strava" options={DIETS} value={prefs.diet} onChange={(diet) => void save({ diet })} />
        </div>
        <div>
          <h3 className="mb-2 text-xs text-mist">Alergeny, kterým se vyhnout</h3>
          <TogglePills
            label="Alergeny"
            options={ALLERGENS}
            value={prefs.allergens}
            onChange={(allergens) => void save({ allergens })}
          />
        </div>
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <p id="household-label" className="mb-1.5 text-xs text-mist">
              Kolik vás doma jí
            </p>
            <div className="flex items-center gap-2" role="group" aria-labelledby="household-label">
              <IconButton
                label="Ubrat"
                variant="glass"
                size="sm"
                disabled={size <= 1}
                onClick={() => void save({ household_size: size - 1 })}
              >
                <Minus className="size-4" />
              </IconButton>
              <span className="tabular min-w-[4.5rem] text-center text-sm text-frost" aria-live="polite">
                {size} {plural(size, "člověk", "lidi", "lidí")}
              </span>
              <IconButton
                label="Přidat"
                variant="glass"
                size="sm"
                disabled={size >= 12}
                onClick={() => void save({ household_size: size + 1 })}
              >
                <Plus className="size-4" />
              </IconButton>
            </div>
          </div>
          <form
            className="w-44"
            onSubmit={(e) => {
              e.preventDefault();
              commitBudget();
            }}
          >
            <Field
              label="Týdenní rozpočet v Kč"
              inputMode="numeric"
              placeholder="bez limitu"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              onBlur={commitBudget}
            />
          </form>
        </div>
      </div>
    </Panel>
  );
}

export function NotifyPanel({ prefs, save }: { prefs: UserPreferences; save: Save }) {
  const [from, to] = prefs.quiet_hours;
  return (
    <Panel aria-labelledby="notify">
      <SectionTitle id="notify">Upozornění</SectionTitle>
      <div className="divide-y divide-white/[0.06]">
        <Toggle
          checked={prefs.notify_low_stock}
          onChange={(v) => void save({ notify_low_stock: v })}
          label="Když něco dochází"
          hint="Došlé základní potraviny rovnou přidám do nákupu."
        />
        <Toggle
          checked={prefs.notify_expiry}
          onChange={(v) => void save({ notify_expiry: v })}
          label="Když se něco blíží datu spotřeby"
          hint="Přidám i nápad, co z toho uvařit."
        />
        <Toggle
          checked={prefs.allow_calls}
          onChange={(v) => void save({ allow_calls: v })}
          label="Frida může zavolat"
          hint="Jen když jde o hodně, nejvýš jednou denně."
        />
      </div>
      <p className="mt-3 text-sm text-mist">
        Tiché hodiny od {from}:00 do {to}:00. Tehdy Frida nevolá, jen pošle tichou zprávu.
      </p>
      <p className="mt-1 text-xs text-haze">
        {prefs.phone_masked ? `Telefon: ${prefs.phone_masked}` : "Telefonní číslo zatím není nastavené (FRIDA_USER_PHONE)."}
      </p>
    </Panel>
  );
}
