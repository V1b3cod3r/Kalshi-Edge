import type { ShoppingItem } from "./types";

export type AmazonStore = "fresh" | "wholefoods";

const STORE_PARAM: Record<AmazonStore, string> = {
  fresh: "amazonfresh",
  wholefoods: "wholefoods",
};

/**
 * Amazon has no public consumer API for adding grocery items to a cart, so
 * we deeplink each shopping-list item into a pre-filtered store search. The
 * user picks the right product and clicks "Add to cart" themselves. This is
 * compliant, requires no credentials, and degrades gracefully if Amazon
 * changes its UI.
 */
export function searchUrl(item: ShoppingItem, store: AmazonStore = "fresh"): string {
  const query = buildQuery(item);
  const i = STORE_PARAM[store];
  return `https://www.amazon.com/s?k=${encodeURIComponent(query)}&i=${i}`;
}

function buildQuery(item: ShoppingItem): string {
  // Strip parenthetical notes ("garlic (peeled)") and trailing descriptors
  // that hurt search precision. Keep it short.
  const cleaned = item.name.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  return cleaned;
}

export function shoppingListAsText(items: ShoppingItem[]): string {
  if (items.length === 0) return "";
  const byCategory = new Map<string, ShoppingItem[]>();
  for (const it of items) {
    const list = byCategory.get(it.category) ?? [];
    list.push(it);
    byCategory.set(it.category, list);
  }
  const sections: string[] = [];
  for (const [cat, list] of byCategory) {
    sections.push(`## ${cat}`);
    for (const it of list) {
      sections.push(`- ${formatAmount(it.amount, it.unit)} ${it.name}`);
    }
    sections.push("");
  }
  return sections.join("\n").trimEnd();
}

export function formatAmount(amount: number, unit: string): string {
  const rounded = Math.round(amount * 100) / 100;
  const num = Number.isInteger(rounded) ? `${rounded}` : `${rounded}`;
  if (!unit || unit === "whole") return num;
  return `${num} ${unit}`;
}
