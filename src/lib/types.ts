export type Step =
  | "home"
  | "background"
  | "scenario"
  | "cs-task"
  | "ops-task"
  | "preference"
  | "compare"
  | "exercise"
  | "done";

export type Preference = "help_customer" | "investigate_pattern" | "unsure" | null;

export type ChosenRole = "customer_success" | "support_operations" | null;

export type ExerciseDuration = 5 | 10;

export type Message = {
  role: "user" | "assistant";
  content: string;
  at: string;
};

export type ExerciseVersion = {
  id: string;
  text: string;
  duration: ExerciseDuration;
  submittedAt: string;
  feedback?: string;
};

export type AppState = {
  version: 1;
  step: Step;
  background: string;
  csAnswer: string;
  opsAnswer: string;
  preference: Preference;
  chosenRole: ChosenRole;
  compareFeedback: CompareFeedback | null;
  conversation: Message[];
  exerciseDuration: ExerciseDuration;
  exerciseDraft: string;
  exerciseVersions: ExerciseVersion[];
  updatedAt: string;
};

export type CompareFeedback = {
  csObservation: string;
  csQuote: string | null;
  opsObservation: string;
  opsQuote: string | null;
  preferenceNote: string;
  gap: string;
  testIdea: string;
};

export const STORAGE_KEY = "roletry-state-v1";

export const INCIDENT =
  "Twenty shops started using a payroll tool this week. Eight contacted support after their first upload failed. Six of those eight mentioned confusion about the date format. One shop runs payroll tomorrow. The cause has not been confirmed.";

export const emptyState = (): AppState => ({
  version: 1,
  step: "home",
  background: "",
  csAnswer: "",
  opsAnswer: "",
  preference: null,
  chosenRole: null,
  compareFeedback: null,
  conversation: [],
  exerciseDuration: 5,
  exerciseDraft: "",
  exerciseVersions: [],
  updatedAt: new Date().toISOString(),
});
