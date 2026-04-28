export type ModelId =
  | "claude-haiku-4-5"
  | "claude-sonnet-4-6"
  | "claude-opus-4-7";

export interface ModelOption {
  id: ModelId;
  name: string;
  blurb: string;
  scoringCostHint: string;
  summaryCostHint: string;
}

export const MODELS: ModelOption[] = [
  {
    id: "claude-haiku-4-5",
    name: "Haiku 4.5",
    blurb: "Fast and cheap. Default.",
    scoringCostHint: "~$0.006 per pull",
    summaryCostHint: "~$0.017 per pull",
  },
  {
    id: "claude-sonnet-4-6",
    name: "Sonnet 4.6",
    blurb: "Better prose, slower, ~3× the cost.",
    scoringCostHint: "~$0.018 per pull",
    summaryCostHint: "~$0.051 per pull",
  },
  {
    id: "claude-opus-4-7",
    name: "Opus 4.7",
    blurb: "Most capable. Overkill for summaries.",
    scoringCostHint: "~$0.030 per pull",
    summaryCostHint: "~$0.085 per pull",
  },
];

export const MODEL_IDS = new Set(MODELS.map((m) => m.id));

export const DEFAULT_MODELS: ModelChoice = {
  scoring: "claude-haiku-4-5",
  summary: "claude-haiku-4-5",
};

export interface ModelChoice {
  scoring: ModelId;
  summary: ModelId;
}

const KEY = "nb_models_v1";

export function loadModels(): ModelChoice {
  if (typeof window === "undefined") return DEFAULT_MODELS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_MODELS;
    const parsed = JSON.parse(raw);
    const scoring = MODEL_IDS.has(parsed?.scoring) ? parsed.scoring : DEFAULT_MODELS.scoring;
    const summary = MODEL_IDS.has(parsed?.summary) ? parsed.summary : DEFAULT_MODELS.summary;
    return { scoring, summary };
  } catch {
    return DEFAULT_MODELS;
  }
}

export function saveModels(choice: ModelChoice): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(choice));
}
