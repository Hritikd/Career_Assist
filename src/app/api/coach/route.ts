import { NextRequest, NextResponse } from "next/server";
import {
  chatCompletion,
  clampText,
  extractJsonObject,
  quoteExists,
  SarvamError,
} from "@/lib/sarvam";
import {
  COMPARE_SYSTEM,
  FOLLOWUP_SYSTEM,
  compareUserPrompt,
  exerciseSystem,
  preferenceLabel,
} from "@/lib/prompts";

export const runtime = "nodejs";
export const maxDuration = 30;

type CoachBody = {
  mode?: "compare" | "followup" | "exercise" | "ping";
  background?: string;
  csAnswer?: string;
  opsAnswer?: string;
  preference?: string;
  chosenRole?: "customer_success" | "support_operations" | null;
  message?: string;
  history?: { role: "user" | "assistant"; content: string }[];
  exerciseDraft?: string;
  exerciseDuration?: 5 | 10;
};

const recent = new Map<string, number>();

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const last = recent.get(ip) || 0;
  if (now - last < 400) return false;
  recent.set(ip, now);
  if (recent.size > 500) {
    for (const [k, v] of recent) {
      if (now - v > 60000) recent.delete(k);
    }
  }
  return true;
}

function errResponse(err: unknown) {
  if (err instanceof SarvamError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status >= 400 && err.status < 600 ? err.status : 502 }
    );
  }
  return NextResponse.json(
    { error: "Unexpected server error. Please retry.", code: "server_error" },
    { status: 500 }
  );
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (!rateLimit(ip)) {
    return NextResponse.json(
      { error: "Please wait a moment before retrying.", code: "rate_limit" },
      { status: 429 }
    );
  }

  let body: CoachBody;
  try {
    body = (await req.json()) as CoachBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const mode = body.mode || "ping";

  try {
    if (mode === "ping") {
      const message = clampText(body.message, 500);
      if (!message) {
        return NextResponse.json({ error: "message required" }, { status: 400 });
      }
      const content = await chatCompletion({
        system:
          "You are a concise career coach. Reply in 1-2 short sentences and refer to a specific detail from the user message.",
        messages: [{ role: "user", content: message }],
        maxTokens: 160,
      });
      return NextResponse.json({ reply: content });
    }

    if (mode === "compare") {
      const background = clampText(body.background, 1500);
      const csAnswer = clampText(body.csAnswer, 2000);
      const opsAnswer = clampText(body.opsAnswer, 2000);
      const preference = clampText(body.preference || "unsure", 80);
      if (!csAnswer.trim() || !opsAnswer.trim()) {
        return NextResponse.json(
          { error: "Both task answers are required." },
          { status: 400 }
        );
      }

      const declined = /^(?:i (?:do not|don.t) know|no idea|idk|unsure|skip|not sure)[.!? ]*$/i;
      if (declined.test(csAnswer.trim()) && declined.test(opsAnswer.trim())) {
        return NextResponse.json({ feedback: {
          csObservation: "Try just the first line you would send to someone whose payroll is due tomorrow.",
          opsObservation: "What would you compare between one failed upload and one successful upload?",
          csQuote: null, opsQuote: null, preferenceNote: preferenceLabel(preference),
          gap: "There is too little work here to tell which task you would enjoy.",
          testIdea: "Pick the easier prompt below. Use Revise my answers to add one sentence, then compare again."
        } });
      }
      const raw = await chatCompletion({
        system: COMPARE_SYSTEM,
        messages: [
          {
            role: "user",
            content: compareUserPrompt({
              background,
              csAnswer,
              opsAnswer,
              preference,
            }),
          },
        ],
        maxTokens: 700,
        json: true,
      });

      let parsed: Record<string, unknown>;
      try {
        parsed = extractJsonObject(raw) as Record<string, unknown>;
      } catch {
        return NextResponse.json(
          {
            error: "Could not parse coaching feedback. Please retry.",
            code: "invalid_response",
          },
          { status: 502 }
        );
      }

      const feedback = {
        csObservation: clampText(parsed.csObservation, 400) || "Add one clearer next step for the shop owner.",
        csQuote: quoteExists(csAnswer, clampText(parsed.csQuote, 120) || null),
        opsObservation:
          clampText(parsed.opsObservation, 400) ||
          "Name one observable result that would tell you the change helped.",
        opsQuote: quoteExists(opsAnswer, clampText(parsed.opsQuote, 120) || null),
        preferenceNote:
          clampText(parsed.preferenceNote, 400) ||
          "Your preference and your current strengths may point in different directions — that is useful information.",
        gap:
          clampText(parsed.gap, 300) ||
          "It is still unclear what result would change your mind about which work you prefer.",
        testIdea:
          clampText(parsed.testIdea, 300) ||
          "Spend five minutes on one role exercise and notice whether you want to continue.",
      };

      if (!feedback.csQuote && csAnswer.trim().length < 40) {
        feedback.csObservation =
          "Your Customer Success answer is thin — add urgency, one question, or a concrete update time.";
      }
      if (!feedback.opsQuote && opsAnswer.trim().length < 40) {
        feedback.opsObservation =
          "Your Operations note needs one test and one observable result.";
      }

      return NextResponse.json({ feedback });
    }

    if (mode === "followup") {
      const message = clampText(body.message, 2000);
      if (!message) {
        return NextResponse.json({ error: "message required" }, { status: 400 });
      }
      const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
      const context = [
        `Background: ${clampText(body.background, 1500) || "(none)"}`,
        `CS answer: ${clampText(body.csAnswer, 1500)}`,
        `Ops answer: ${clampText(body.opsAnswer, 1500)}`,
        `Preference: ${preferenceLabel(clampText(body.preference, 80))}`,
        `Chosen role: ${body.chosenRole || "not chosen"}`,
      ].join("\n");

      const messages = [
        { role: "user" as const, content: `Context:\n${context}` },
        ...history.map((m) => ({
          role: m.role as "user" | "assistant",
          content: clampText(m.content, 1500),
        })),
        { role: "user" as const, content: message },
      ];

      const firstTask = Boolean(body.csAnswer?.trim() && !body.opsAnswer?.trim() && !body.chosenRole);
      if (firstTask) {
        const answer = clampText(body.csAnswer, 2000);
        const time = answer.match(/\b(?:by|at|within|in)\s+(?:noon|midnight|\d{1,2}(?::\d{2})?(?:\s*(?:am|pm|minutes?|hours?))?)\b/i);
        if (time && /\b(updat\w*|call|check back|follow up)\b/i.test(answer) && !/\b(guarantee|promise|fix(?:ed)?)\b/i.test(answer)) {
          return NextResponse.json({ reply: `“${time[0]}” gives the owner a time to expect news while you investigate. Six shops mentioned the date format. What would you compare in one failed file and one successful file before recommending a change?` });
        }
      }
      const reply = await chatCompletion({
        system: firstTask
          ? "Coach the customer message in this payroll exercise. Quote one exact phrase, explain how it helps or where it risks misleading the owner, then ask one concrete diagnostic question about failed versus successful uploads. A promised update time is not a promised resolution. If the learner requests error text, acknowledge that request; never fault them for not already having the answer. Keep it to two sentences. Only discuss the submitted work; do not infer preferences or recommend a career."
          : FOLLOWUP_SYSTEM + " Only reference preferences explicitly supplied by this user. The learner selects and saves a direction using the role buttons.",
        messages,
        maxTokens: 280,
      });
      return NextResponse.json({ reply });
    }

    if (mode === "exercise") {
      const role = body.chosenRole;
      if (role !== "customer_success" && role !== "support_operations") {
        return NextResponse.json({ error: "chosenRole required" }, { status: 400 });
      }
      const draft = clampText(body.exerciseDraft, 2500);
      if (!draft.trim()) {
        return NextResponse.json({ error: "exerciseDraft required" }, { status: 400 });
      }
      if (role === "support_operations" && /\b(?:no[- ]hint|without (?:a |the )?hint|control group)\b/i.test(draft) && /\b(success|succeed|successful)\b/i.test(draft) && /\b(upload|uploaders)\b/i.test(draft)) {
        const control = draft.match(/\b(?:no[- ]hint|without (?:a |the )?hint|control group)\b/i)![0];
        const next = /\b(?:equal|same rate|no (?:lift|difference|improvement))\b/i.test(draft)
          ? "You also named a result that could weaken your idea. Check each group’s size before interpreting a small difference."
          : "Add your decision rule: if first-upload success is similar in both groups, investigate another cause before rolling out the hint.";
        return NextResponse.json({ reply: `Your “${control}” comparison gives you a baseline for first-upload success. ${next}` });
      }
      const duration = body.exerciseDuration === 10 ? 10 : 5;
      const extra =
        duration === 10
          ? role === "customer_success"
            ? "Also check whether they offered a temporary workaround without promising a verified root cause."
            : "Also check whether they named a sample size or time window for the test."
          : "";

      const reply = await chatCompletion({
        system: exerciseSystem(role),
        messages: [
          {
            role: "user",
            content: `Duration: ${duration} minutes.\nBackground: ${clampText(body.background, 1000) || "(none)"}\nDraft:\n${draft}\n${extra}`,
          },
        ],
        maxTokens: 280,
      });
      return NextResponse.json({ reply });
    }

    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  } catch (err) {
    return errResponse(err);
  }
}
