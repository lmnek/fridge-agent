import { motion } from "motion/react";
import type { BusEvent } from "../bus";
import { CardFrame, Tag, latest, rise, stagger } from "./ui";
import "./RecipeCard.css";

type Recipe = { title: string; have?: string[]; missing?: string[]; steps?: string[] };

const Check = () => (
  <svg width="28" height="28" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 13.5l5.5 5.5L21 7.5" />
  </svg>
);
const Cross = () => (
  <svg width="28" height="28" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
    <path d="M6 6l14 14M20 6L6 20" />
  </svg>
);

export default function RecipeCard({ events }: { events: BusEvent[] }) {
  const recipe: Recipe | undefined =
    latest(events, "recipe")?.recipe ?? latest(events, "tool", (e) => e.name === "show_recipe")?.args;
  if (!recipe) return <CardFrame icon="C2" kicker="Recipe" title="Picking a recipe" live />;

  const have = recipe.have ?? [];
  const missing = recipe.missing ?? [];
  const gf = (n: string) => /gluten/i.test(n);

  return (
    <CardFrame icon="C2" kicker="Recipe for tonight" title={recipe.title} live={false} aside={`${missing.length} to add`}>
      <motion.ul className="ck-recipe-list" variants={stagger} initial="hidden" animate="show">
        {missing.map((n) => (
          <motion.li key={n} variants={rise} className="ck-recipe-row is-missing">
            <span className="ck-recipe-icon"><Cross /></span>
            <span className="ck-recipe-name">
              {n}
              {gf(n) && <small>for Anna</small>}
            </span>
            <Tag tone="gone">Add to cart</Tag>
          </motion.li>
        ))}
        {have.map((n) => (
          <motion.li key={n} variants={rise} className="ck-recipe-row is-have">
            <span className="ck-recipe-icon"><Check /></span>
            <span className="ck-recipe-name">{n}</span>
            <Tag tone="ok">Have it</Tag>
          </motion.li>
        ))}
      </motion.ul>
      {recipe.steps?.length ? (
        <motion.ol className="ck-recipe-steps" variants={rise} initial="hidden" animate="show">
          {recipe.steps.map((s) => <li key={s}>{s}</li>)}
        </motion.ol>
      ) : null}
    </CardFrame>
  );
}
