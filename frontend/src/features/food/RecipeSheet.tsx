import { useState } from "react";
import { Check, Clock, ExternalLink, ShoppingCart } from "lucide-react";
import type { RecipeSuggestion } from "../../lib/types";
import { api } from "../../lib/api";
import { useApp } from "../../store/app";
import { Sheet } from "../../ui/Sheet";
import { Button } from "../../ui/Button";
import { askFrida } from "../chat/voiceTurn";
import { RescueRing, rescueColor } from "./RecipeCard";

export function RecipeSheet({
  recipe,
  onClose,
  onCooked,
}: {
  recipe: RecipeSuggestion | null;
  onClose: () => void;
  onCooked?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cook = async () => {
    if (!recipe) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.cooked(recipe);
      useApp.getState().toast({
        title: `Uvařeno: ${recipe.title}`,
        body: res.used.length
          ? `Z lednice jsem odečetla ${res.used.join(", ").toLowerCase()}.`
          : "Z lednice jsem nic neodečetla, suroviny už v ní nejsou.",
        tone: "success",
      });
      onCooked?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nepovedlo se to uložit.");
    } finally {
      setBusy(false);
    }
  };

  const buyMissing = () => {
    if (!recipe) return;
    onClose();
    void askFrida(`Dej do košíku v Rohlíku, co chybí na ${recipe.title.toLowerCase()}: ${recipe.missing.join(", ")}`);
  };

  return (
    <Sheet
      open={recipe !== null}
      onClose={onClose}
      title={recipe?.title ?? ""}
      subtitle={
        recipe ? (
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" aria-hidden />
            {recipe.minutes} min
          </span>
        ) : undefined
      }
      footer={
        recipe ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {error && <p className="mr-auto text-sm text-tomato">{error}</p>}
            {recipe.missing.length > 0 && (
              <Button variant="glass" icon={<ShoppingCart className="size-4" aria-hidden />} onClick={buyMissing}>
                Dokoupit chybějící
              </Button>
            )}
            <Button variant="primary" icon={<Check className="size-4" aria-hidden />} busy={busy} onClick={() => void cook()}>
              Uvařeno
            </Button>
          </div>
        ) : undefined
      }
    >
      {recipe && (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <RescueRing recipe={recipe} size={72} />
            <p className="text-sm text-mist">
              {recipe.rescue_score > 0 ? (
                <>
                  Tenhle recept zachrání{" "}
                  <span className="font-semibold" style={{ color: rescueColor(recipe.rescue_score) }}>
                    {recipe.rescue_score} %
                  </span>{" "}
                  z věcí, které se brzy zkazí.
                </>
              ) : (
                "Nic z toho, co se brzy zkazí, tenhle recept nepoužije. Je ale z toho, co máš doma."
              )}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-frost">Z lednice</h3>
              {recipe.uses.length ? (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {recipe.uses.map((u) => (
                    <li key={u} className="rounded-full bg-glacier/10 px-3 py-1 text-[13px] text-frost">
                      {u}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-mist">Nic, všechno se dokupuje.</p>
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-frost">Dokoupit</h3>
              {recipe.missing.length ? (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {recipe.missing.map((u) => (
                    <li key={u} className="rounded-full bg-apricot/12 px-3 py-1 text-[13px] text-apricot">
                      {u}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-mist">Nic, všechno máš doma.</p>
              )}
            </div>
          </div>

          {recipe.steps.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-frost">Postup</h3>
              <ol className="mt-3 space-y-3">
                {recipe.steps.map((step, i) => (
                  <li key={i} className="grid grid-cols-[28px_1fr] gap-3">
                    <span className="tabular grid size-7 place-items-center rounded-full border border-white/10 text-xs text-mist">
                      {i + 1}
                    </span>
                    <span className="pt-0.5 text-[15px] leading-relaxed text-frost/90">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {recipe.url && (
            <a
              href={recipe.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-glacier underline underline-offset-2"
            >
              Celý recept
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
        </div>
      )}
    </Sheet>
  );
}
