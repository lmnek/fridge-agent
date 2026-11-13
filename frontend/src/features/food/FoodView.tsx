import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bike, CookingPot, RotateCcw, ShoppingBasket, ShoppingCart, Sparkles } from "lucide-react";
import { PageHeader } from "../../components/shell/PageHeader";
import { api } from "../../lib/api";
import type { CravingAnswer, RecipeSuggestion } from "../../lib/types";
import { cx } from "../../lib/format";
import { DemoTag, Empty, Panel, SectionTitle, Skeleton } from "../../ui/bits";
import { Button } from "../../ui/Button";
import { askFrida } from "../chat/voiceTurn";
import { RecipeCard } from "./RecipeCard";
import { RecipeSheet } from "./RecipeSheet";
import { VenueCard } from "./VenueCard";

const QUICK = ["Pizza", "Něco s rýží", "Rychlá večeře", "Polévka", "Něco sladkého", "Něco lehkého"];

type Load<T> = { status: "idle" | "loading" | "ok" | "error"; data?: T; error?: string };

function errText(err: unknown): string {
  return err instanceof Error ? err.message : "Nepodařilo se to načíst.";
}

function ErrorLine({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-tomato/25 bg-tomato/[0.07] px-4 py-3 text-sm">
      <span className="text-frost">{message}</span>
      <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" aria-hidden />} onClick={onRetry}>
        Zkusit znovu
      </Button>
    </div>
  );
}

function Column({
  icon,
  title,
  count,
  aside,
  children,
}: {
  icon: ReactNode;
  title: string;
  count: number;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Panel className="flex min-w-0 flex-col">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-full bg-white/[0.06] text-glacier" aria-hidden>
          {icon}
        </span>
        <h3 className="flex-1 text-[17px] font-semibold text-frost">{title}</h3>
        {aside}
        <span className="tabular text-sm text-haze">{count}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2.5">{children}</div>
    </Panel>
  );
}

function ColumnEmpty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-mist">{children}</p>;
}

function CravingResult({ answer, onOpen }: { answer: CravingAnswer; onOpen: (r: RecipeSuggestion) => void }) {
  const demoVenues = answer.order_in.some((v) => v.provider === "demo");
  const missingAll = Array.from(new Set(answer.buy_and_cook.flatMap((r) => r.missing)));
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <p className="mb-5 max-w-3xl font-display text-[21px] leading-snug font-light text-frost sm:text-[24px]" aria-live="polite">
        {answer.message}
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        <Column icon={<CookingPot className="size-4" />} title="Uvař hned" count={answer.cook_now.length}>
          {answer.cook_now.length ? (
            answer.cook_now.map((r) => <RecipeCard key={r.id} recipe={r} onOpen={onOpen} />)
          ) : (
            <ColumnEmpty>Na tohle teď doma suroviny nemáš. Mrkni vedle, co dokoupit.</ColumnEmpty>
          )}
        </Column>
        <Column icon={<ShoppingBasket className="size-4" />} title="Dokup a uvař" count={answer.buy_and_cook.length}>
          {answer.buy_and_cook.length ? (
            <>
              {answer.buy_and_cook.map((r) => (
                <RecipeCard key={r.id} recipe={r} onOpen={onOpen} />
              ))}
              {missingAll.length > 0 && (
                <Button
                  variant="glass"
                  className="mt-auto self-start"
                  icon={<ShoppingCart className="size-4" aria-hidden />}
                  onClick={() => void askFrida(`Dej do košíku v Rohlíku: ${missingAll.join(", ")}`)}
                >
                  Dej chybějící do košíku
                </Button>
              )}
            </>
          ) : (
            <ColumnEmpty>Tady nic není potřeba, uvařit se dá rovnou z lednice.</ColumnEmpty>
          )}
        </Column>
        <Column
          icon={<Bike className="size-4" />}
          title="Nech si dovézt"
          count={answer.order_in.length}
          aside={demoVenues ? <DemoTag>ukázkové podniky</DemoTag> : undefined}
        >
          {answer.order_in.length ? (
            answer.order_in.map((v) => <VenueCard key={v.id} venue={v} />)
          ) : (
            <ColumnEmpty>Rozvoz tu teď nic nenašel. Zkus to popsat jinak.</ColumnEmpty>
          )}
        </Column>
      </div>
    </motion.div>
  );
}

export function FoodView() {
  const [text, setText] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Load<CravingAnswer>>({ status: "idle" });
  const [base, setBase] = useState<Load<{ message: string | null; recipes: RecipeSuggestion[] }>>({ status: "loading" });
  const [open, setOpen] = useState<RecipeSuggestion | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const loadBase = useCallback(async () => {
    setBase((b) => ({ ...b, status: "loading" }));
    try {
      const res = await api.recipes();
      const recipes = [...res.recipes].sort((a, b) => b.rescue_score - a.rescue_score);
      setBase({ status: "ok", data: { message: res.message, recipes } });
    } catch (err) {
      setBase({ status: "error", error: errText(err) });
    }
  }, []);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  const ask = useCallback(async (craving: string, quiet = false) => {
    const t = craving.trim();
    if (!t) return;
    setAsked(t);
    setAnswer((a) => (quiet && a.data ? a : { status: "loading" }));
    try {
      const data = await api.craving(t);
      setAnswer({ status: "ok", data });
    } catch (err) {
      setAnswer({ status: "error", error: errText(err) });
    }
  }, []);

  const closeRecipe = useCallback(() => setOpen(null), []);

  const afterCooked = () => {
    void loadBase();
    if (asked) void ask(asked, true);
  };

  return (
    <div className="pb-8">
      <PageHeader
        title="Na co máš chuť?"
        lead="Poradím, co uvařit z toho, co máš doma, co dokoupit, nebo kde si to nechat přivézt."
      />

      <form
        className="glass relative mb-8 flex flex-col gap-3 rounded-[28px] p-3 sm:flex-row sm:items-center sm:p-2.5 sm:pl-6"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text);
        }}
      >
        <label htmlFor="craving" className="sr-only">
          Na co máš chuť
        </label>
        <input
          id="craving"
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Třeba pizza nebo něco s rýží"
          autoComplete="off"
          maxLength={200}
          className="h-14 min-w-0 flex-1 bg-transparent px-3 font-display text-[20px] font-light text-frost outline-none placeholder:text-haze sm:px-0 sm:text-[28px]"
        />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={!text.trim()}
          busy={answer.status === "loading"}
          icon={<Sparkles className="size-4.5" aria-hidden />}
        >
          Poradit
        </Button>
      </form>

      <div className="no-scrollbar -mt-5 mb-8 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Rychlé nápady">
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => {
              setText(q);
              void ask(q);
            }}
            className={cx(
              "frost-chip h-9 shrink-0 rounded-full px-4 text-sm transition-colors hover:text-frost",
              asked === q ? "border-glacier/40 text-glacier" : "text-mist",
            )}
          >
            {q}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {answer.status === "loading" && !answer.data && (
          <motion.div key="loading" exit={{ opacity: 0 }} className="mb-10 grid gap-4 lg:grid-cols-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-64 rounded-[26px]" />
            ))}
          </motion.div>
        )}
        {answer.status === "error" && (
          <motion.div key="error" className="mb-10">
            <ErrorLine message={answer.error ?? "Nepodařilo se to."} onRetry={() => asked && void ask(asked)} />
          </motion.div>
        )}
        {answer.data && answer.status !== "error" && (
          <motion.section key={`answer-${answer.data.craving}`} className="mb-12" aria-label={`Nápady na ${answer.data.craving}`}>
            <CravingResult answer={answer.data} onOpen={setOpen} />
          </motion.section>
        )}
      </AnimatePresence>

      <section aria-labelledby="from-fridge">
        <SectionTitle id="from-fridge">Co uvařit z toho, co máš</SectionTitle>
        {base.data?.message && <p className="-mt-1 mb-4 max-w-2xl text-sm text-mist">{base.data.message}</p>}
        {base.status === "loading" && !base.data ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-[112px] rounded-[20px]" />
            ))}
          </div>
        ) : base.status === "error" ? (
          <ErrorLine message={base.error ?? "Recepty se nenačetly."} onRetry={() => void loadBase()} />
        ) : base.data?.recipes.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {base.data.recipes.map((r) => (
              <RecipeCard key={r.id} recipe={r} onOpen={setOpen} />
            ))}
          </div>
        ) : (
          <Empty title="Lednice je skoro prázdná">
            Z toho, co tam je, nic pořádného neuvařím. Napiš nahoru, na co máš chuť, a poradím, co dokoupit.
          </Empty>
        )}
      </section>

      <RecipeSheet recipe={open} onClose={closeRecipe} onCooked={afterCooked} />
    </div>
  );
}
