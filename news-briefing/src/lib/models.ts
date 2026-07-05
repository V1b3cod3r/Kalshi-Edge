export type ModelId =
  | "claude-haiku-4-5"
  | "claude-sonnet-4-6"
  | "claude-opus-4-7";

export interface ModelOption {
  id: ModelId;
  name: string;
  blurb: string;
  summaryCostHint: string;
}

export const MODELS: ModelOption[] = [
  {
    id: "claude-haiku-4-5",
    name: "Haiku 4.5",
    blurb: "Fast and cheap. Default.",
    summaryCostHint: "~$0.017 per fresh pull",
  },
  {
    id: "claude-sonnet-4-6",
    name: "Sonnet 4.6",
    blurb: "Better prose, slower, ~3× the cost.",
    summaryCostHint: "~$0.051 per fresh pull",
  },
  {
    id: "claude-opus-4-7",
    name: "Opus 4.7",
    blurb: "Most capable. Overkill for summaries.",
    summaryCostHint: "~$0.085 per fresh pull",
  },
];

export const MODEL_IDS = new Set(MODELS.map((m) => m.id));

// Relevance scoring and clustering are internal ranking calls (the user
// never reads their output) and always run on Haiku — see buildBriefing()
// in briefing.ts. Only the summary model is user-configurable.
export const DEFAULT_MODELS: ModelChoice = {
  summary: "claude-haiku-4-5",
};

export interface ModelChoice {
  summary: ModelId;
}

const KEY = "nb_models_v1";

export function loadModels(): ModelChoice {
  if (typeof window === "undefined") return DEFAULT_MODELS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_MODELS;
    const parsed = JSON.parse(raw);
    const summary = MODEL_IDS.has(parsed?.summary) ? parsed.summary : DEFAULT_MODELS.summary;
    return { summary };
  } catch {
    return DEFAULT_MODELS;
  }
}

export function saveModels(choice: ModelChoice): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(choice));
}
