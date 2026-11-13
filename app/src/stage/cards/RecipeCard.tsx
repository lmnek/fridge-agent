import { motion } from "motion/react";
import type { BusEvent } from "../bus";
import { CardFrame, latest, rise, stagger } from "./ui";
import "./RecipeCard.css";

type Recipe = { title: string; have?: string[]; missing?: string[]; steps?: string[] };

const Plus = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
    <path d="M11 4v14M4 11h14" />
  </svg>
);
const Check = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 11.5l4.5 4.5L18 6.5" />
  </svg>
);

// A diet note for a row, read off the ingredient's own name (the recipe tool sends plain names).
const note = (n: string) => (/gluten/i.test(n) ? "for Anna" : undefined);

export default function RecipeCard({ events }: { events: BusEvent[] }) {
  const recipe: Recipe | undefined =
    latest(events, "recipe")?.recipe ?? latest(events, "tool", (e) => e.name === "show_recipe")?.args;
  if (!recipe) return <CardFrame icon="C2" kicker="Recipe" title="Picking a recipe" live />;

  const have = recipe.have ?? [];
  const missing = recipe.missing ?? [];
  const steps = (recipe.steps ?? []).slice(0, 4);

  return (
    <CardFrame
      icon="C2"
      kicker="Recipe for tonight"
      title={recipe.title}
      live={false}
      aside={<span className="ck-recipe-aside">{have.length + missing.length} ingredients</span>}
    >
      {/* What's missing is the card: one red block the eye lands on, each row a thing going into the cart. */}
      <section className="ck-recipe-missing">
        <p className="ck-recipe-label is-gone">
          {missing.length} missing, going in the cart
        </p>
        <motion.ul className="ck-recipe-list" variants={stagger} initial="hidden" animate="show">
          {missing.map((n) => (
            <motion.li key={n} variants={rise} className="ck-recipe-row">
              <span className="ck-recipe-mark"><Plus /></span>
              <span className="ck-recipe-name">{n}</span>
              {note(n) && <span className="ck-recipe-note">{note(n)}</span>}
            </motion.li>
          ))}
        </motion.ul>
      </section>

      {/* What's already in: one quiet line, it only needs to read as "covered". */}
      {have.length > 0 && (
        <motion.section className="ck-recipe-have" variants={rise} initial="hidden" animate="show">
          <p className="ck-recipe-label is-ok">Already in the fridge</p>
          <ul>
            {have.map((n) => (
              <li key={n}>
                <span className="ck-recipe-check"><Check /></span>
                {n}
              </li>
            ))}
          </ul>
        </motion.section>
      )}

      {steps.length > 0 && (
        <motion.ol className="ck-recipe-steps" variants={rise} initial="hidden" animate="show">
          {steps.map((s, i) => (
            <li key={s}>
              <span className="ck-recipe-step-n">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </motion.ol>
      )}
    </CardFrame>
  );
}
