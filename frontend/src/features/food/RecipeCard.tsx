import { Clock } from "lucide-react";
import type { RecipeSuggestion } from "../../lib/types";
import { cx } from "../../lib/format";
import { Ring } from "../../ui/bits";

/** Barva záchrany: čím víc jídla recept zachrání, tím chladnější a jasnější světlo. */
export function rescueColor(score: number): string {
  if (score >= 60) return "var(--color-glacier)";
  if (score >= 30) return "var(--color-butter)";
  return "var(--color-mist)";
}

export function RescueRing({ recipe, size = 56 }: { recipe: RecipeSuggestion; size?: number }) {
  return (
    <Ring
      value={recipe.rescue_score / 100}
      size={size}
      stroke={size > 50 ? 4 : 3}
      color={rescueColor(recipe.rescue_score)}
      label={`Zachrání ${recipe.rescue_score} % z věcí, které se brzy zkazí`}
    >
      <span className={size > 50 ? "text-[15px] font-semibold text-frost" : "text-[13px] font-semibold text-frost"} aria-hidden>
        {recipe.rescue_score} %
      </span>
    </Ring>
  );
}

export function RecipeCard({
  recipe,
  onOpen,
  className,
}: {
  recipe: RecipeSuggestion;
  onOpen: (r: RecipeSuggestion) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(recipe)}
      className={cx(
        "frost-chip group flex w-full items-start gap-3.5 rounded-[20px] p-3.5 text-left transition-colors hover:border-glacier/30 hover:bg-white/[0.07]",
        className,
      )}
    >
      <RescueRing recipe={recipe} />
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[17px] leading-snug font-semibold text-frost">{recipe.title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-mist">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" aria-hidden />
            {recipe.minutes} min
          </span>
          {recipe.rescue_score > 0 && (
            <span style={{ color: rescueColor(recipe.rescue_score) }}>zachrání {recipe.rescue_score} %</span>
          )}
        </span>
        {recipe.uses.length > 0 && (
          <span className="mt-1.5 line-clamp-2 block text-[13px] leading-snug text-mist">
            Z lednice: <span className="text-frost/85">{recipe.uses.join(", ").toLowerCase()}</span>
          </span>
        )}
        {recipe.missing.length > 0 && (
          <span className="mt-1 line-clamp-2 block text-[13px] leading-snug text-apricot">
            Dokoupit: {recipe.missing.join(", ").toLowerCase()}
          </span>
        )}
      </span>
    </button>
  );
}
