import type { Category, Shelf, Unit } from "../../lib/types";

export const CATEGORY_LABEL: Record<Category, string> = {
  dairy: "Mléčné",
  cheese: "Sýry",
  eggs: "Vejce",
  meat: "Maso",
  fish: "Ryby",
  deli: "Uzeniny",
  vegetables: "Zelenina",
  fruit: "Ovoce",
  bakery: "Pečivo",
  drinks: "Nápoje",
  ready_meals: "Hotová jídla",
  condiments: "Omáčky a dresinky",
  frozen: "Mražené",
  other: "Ostatní",
};

export const SHELF_LABEL: Record<Shelf, string> = {
  top: "Horní police",
  middle: "Prostřední police",
  bottom: "Spodní police",
  door: "Dveře",
  drawer: "Šuplík",
  unknown: "Nevím",
};

export const UNITS: Unit[] = ["ks", "bal", "g", "kg", "ml", "l"];

export const options = <T extends string>(labels: Record<T, string>) =>
  (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
