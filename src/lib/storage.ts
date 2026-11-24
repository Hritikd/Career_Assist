import { AppState, STORAGE_KEY, emptyState } from "./types";

export function loadState(): AppState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<AppState>;
    if (parsed.version !== 1 || typeof parsed !== "object") return emptyState();
    return {
      ...emptyState(),
      ...parsed,
      conversation: Array.isArray(parsed.conversation) ? parsed.conversation : [],
      exerciseVersions: Array.isArray(parsed.exerciseVersions)
        ? parsed.exerciseVersions
        : [],
    };
  } catch {
    return emptyState();
  }
}

export function saveState(state: AppState): void {
  if (typeof window === "undefined") return;
  const next = { ...state, updatedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function clearState(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function resumeLabel(step: AppState["step"]): string {
  switch (step) {
    case "home":
      return "Try the roles";
    case "background":
      return "Continue";
    case "scenario":
      return "Continue the scenario";
    case "cs-task":
      return "Resume Customer Success task";
    case "ops-task":
      return "Resume Support Operations task";
    case "preference":
      return "Choose which task you prefer";
    case "compare":
      return "Resume your comparison";
    case "exercise":
      return "Resume your exercise";
    case "done":
      return "Review your work";
    default:
      return "Continue";
  }
}
