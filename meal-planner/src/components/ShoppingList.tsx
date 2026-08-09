"use client";

import { useMemo, useState } from "react";
import type { ShoppingCategory, ShoppingItem } from "@/lib/types";
import { SHOPPING_CATEGORIES } from "@/lib/types";
import { formatAmount, searchUrl, shoppingListAsText, type AmazonStore } from "@/lib/amazon";

const CATEGORY_LABEL: Record<ShoppingCategory, string> = {
  produce: "Produce",
  "meat-seafood": "Meat & seafood",
  "dairy-eggs": "Dairy & eggs",
  pantry: "Pantry",
  "grains-bread": "Grains & bread",
  frozen: "Frozen",
  beverages: "Beverages",
  other: "Other",
};

export function ShoppingList({ items }: { items: ShoppingItem[] }) {
  const [store, setStore] = useState<AmazonStore>("fresh");
  const [copied, setCopied] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());

  const grouped = useMemo(() => {
    const map = new Map<ShoppingCategory, ShoppingItem[]>();
    for (const it of items) {
      const list = map.get(it.category) ?? [];
      list.push(it);
      map.set(it.category, list);
    }
    return SHOPPING_CATEGORIES.map((cat) => ({ cat, list: map.get(cat) ?? [] })).filter(
      (g) => g.list.length > 0,
    );
  }, [items]);

  function key(it: ShoppingItem): string {
    return `${it.name}::${it.unit}`;
  }

  function toggle(it: ShoppingItem) {
    setChecked((prev) => {
      const next = new Set(prev);
      const k = key(it);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(shoppingListAsText(items));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — clipboard may be denied; user can still use the links
    }
  }

  if (items.length === 0) {
    return (
      <section className="rounded-2xl bg-surface shadow-card p-6 text-[14px] text-ink-muted">
        Your pantry already covers this week. Nothing to buy.
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-surface shadow-card p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-ink">
          Shopping list
        </h2>
        <div className="flex items-center gap-2">
          <StoreToggle value={store} onChange={setStore} />
          <button
            type="button"
            onClick={copyText}
            className="pressable rounded-full border border-surface-line bg-surface px-3 py-1.5 text-[13px] text-ink-soft hover:text-ink"
          >
            {copied ? "Copied" : "Copy as text"}
          </button>
        </div>
      </div>
      <p className="mt-1 text-[13px] text-ink-muted">
        Each item opens an Amazon {store === "fresh" ? "Fresh" : "Whole Foods"} search in a new
        tab. Pick the right product, add to cart, then check it off here.
      </p>
      <div className="mt-5 space-y-6">
        {grouped.map(({ cat, list }) => (
          <div key={cat}>
            <h3 className="text-[12px] uppercase tracking-[0.12em] text-ink-faint">
              {CATEGORY_LABEL[cat]}
            </h3>
            <ul className="mt-2 divide-y divide-surface-line">
              {list.map((it) => {
                const k = key(it);
                const isChecked = checked.has(k);
                return (
                  <li key={k} className="flex items-center gap-3 py-2">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggle(it)}
                      className="h-4 w-4 accent-accent"
                      aria-label={`Got ${it.name}`}
                    />
                    <div className={`flex-1 ${isChecked ? "line-through text-ink-faint" : "text-ink"}`}>
                      <span className="text-[14px]">{it.name}</span>
                      <span className="ml-2 text-[13px] text-ink-muted">
                        {formatAmount(it.amount, it.unit)}
                      </span>
                    </div>
                    <a
                      href={searchUrl(it, store)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="pressable rounded-full bg-accent px-3 py-1 text-[12px] font-medium text-white"
                    >
                      Open
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function StoreToggle({ value, onChange }: { value: AmazonStore; onChange: (v: AmazonStore) => void }) {
  const options: { id: AmazonStore; label: string }[] = [
    { id: "fresh", label: "Fresh" },
    { id: "wholefoods", label: "Whole Foods" },
  ];
  return (
    <div className="inline-flex rounded-full bg-surface-tint p-0.5 text-[13px]">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={`pressable rounded-full px-3 py-1 ${
            value === opt.id
              ? "bg-surface text-ink shadow-card"
              : "text-ink-muted hover:text-ink"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
