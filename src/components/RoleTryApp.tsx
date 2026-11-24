"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import VoiceButton from "./VoiceButton";
import {
  AppState,
  ExerciseVersion,
  INCIDENT,
  Preference,
  Step,
  emptyState,
} from "@/lib/types";
import { clearState, loadState, resumeLabel, saveState } from "@/lib/storage";

const STEPS: Step[] = [
  "home",
  "background",
  "scenario",
  "cs-task",
  "ops-task",
  "preference",
  "compare",
  "exercise",
  "done",
];

export default function RoleTryApp() {
  const [state, setState] = useState<AppState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firstNote, setFirstNote] = useState("");
  const [followup, setFollowup] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const submitLock = useRef(false);

  useEffect(() => {
    setState(loadState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || !state) return;
    saveState(state);
    setSavedFlash(true);
    const t = window.setTimeout(() => setSavedFlash(false), 1200);
    return () => window.clearTimeout(t);
  }, [state, hydrated]);

  const progressIndex = useMemo(() => {
    if (!state) return 0;
    return Math.max(0, STEPS.indexOf(state.step));
  }, [state]);

  function update(patch: Partial<AppState> | ((prev: AppState) => AppState)) {
    setState((prev) => {
      const base = prev ?? emptyState();
      return typeof patch === "function" ? patch(base) : { ...base, ...patch };
    });
  }

  async function callCoach(payload: Record<string, unknown>) {
    if (submitLock.current) return null;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setError(msg);
      return null;
    } finally {
      setBusy(false);
      submitLock.current = false;
    }
  }

  async function runCompare() {
    if (!state) return;
    const data = await callCoach({
      mode: "compare",
      background: state.background,
      csAnswer: state.csAnswer,
      opsAnswer: state.opsAnswer,
      preference: state.preference,
    });
    if (!data?.feedback) return;
    update({ compareFeedback: data.feedback, step: "compare" });
  }

  async function sendFollowup() {
    if (!state || !followup.trim()) return;
    const message = followup.trim();
    const history = state.conversation.map(({ role, content }) => ({ role, content }));
    const data = await callCoach({
      mode: "followup",
      message,
      history,
      background: state.background,
      csAnswer: state.csAnswer,
      opsAnswer: state.opsAnswer,
      preference: state.preference,
      chosenRole: state.chosenRole,
    });
    if (!data?.reply) return;

    setFollowup("");
    update((prev) => ({
      ...prev,
      conversation: [
        ...prev.conversation,
        { role: "user", content: message, at: new Date().toISOString() },
        { role: "assistant", content: data.reply, at: new Date().toISOString() },
      ],
    }));
  }

  async function submitExercise() {
    if (!state || !state.chosenRole || !state.exerciseDraft.trim()) return;
    const data = await callCoach({
      mode: "exercise",
      chosenRole: state.chosenRole,
      exerciseDraft: state.exerciseDraft,
      exerciseDuration: state.exerciseDuration,
      background: state.background,
    });
    if (!data?.reply) return;
    const version: ExerciseVersion = {
      id: `${Date.now()}`,
      text: state.exerciseDraft,
      duration: state.exerciseDuration,
      submittedAt: new Date().toISOString(),
      feedback: data.reply,
    };
    update({
      exerciseVersions: [...state.exerciseVersions, version],
      step: "done",
    });
  }

  function resetAll() {
    setFirstNote("");
    setError(null);
    clearState();
    setState(emptyState());
    setFollowup("");
    setError(null);
  }

  if (!hydrated || !state) {
    return (
      <main className="app-shell">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  const hasProgress =
    state.step !== "home" ||
    !!state.background ||
    !!state.csAnswer ||
    !!state.opsAnswer ||
    state.exerciseVersions.length > 0;

  function resumeStep(s: AppState): Step {
    if (s.step !== "home") return s.step;
    if (s.exerciseVersions.length > 0 || s.exerciseDraft) return "exercise";
    if (s.compareFeedback) return "compare";
    if (s.preference) return "preference";
    if (s.opsAnswer) return "preference";
    if (s.csAnswer) return "ops-task";
    if (s.background) return "scenario";
    return "background";
  }

  const showFacts = !["home", "background"].includes(state.step);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">RoleTry</div>
        <div className="credit">Independent prototype by Hritik Datta</div>
      </header>

      <div className={`layout ${showFacts ? "split" : ""}`}>
        {showFacts ? (
          <aside className="panel facts">
            <h2>The incident</h2>
            <p>{INCIDENT}</p>
            <p className="muted" style={{ marginTop: 14 }}>
              Customer Success: help the shop keep payroll moving.
              <br />
              Support Operations: find whether date format is the pattern.
            </p>
            {state.background ? (
              <>
                <h2 style={{ marginTop: 18 }}>Your background</h2>
                <div className="user-words">{state.background}</div>
              </>
            ) : null}
          </aside>
        ) : null}

        <section className="panel">
          <div className="progress" aria-hidden>
            {STEPS.map((s, i) => (
              <span key={s} className={`dot ${i <= progressIndex ? "on" : ""}`} />
            ))}
          </div>

          {state.step === "home" && (
            <>
              <h1>Try two roles on the same customer problem.</h1>
              <p className="lede">
                See which work you want to do more of — Customer Success or Support
                Operations — using one payroll incident.
              </p>
              <p className="muted">
                Built for customer support folks in India considering a move, and
                final-year students exploring the same pair.
              </p>
              <div className="actions">
                <button
                  className="btn"
                  onClick={() => update({ step: resumeStep(state) })}
                >
                  {hasProgress ? resumeLabel(resumeStep(state)) : "Try the roles"}
                </button>
                {hasProgress ? (
                  <button className="btn danger" onClick={resetAll}>
                    Reset this device
                  </button>
                ) : null}
              </div>
            </>
          )}

          {state.step === "background" && (
            <>
              <h1>Quick context</h1>
              <label className="label" htmlFor="bg">
                What do you do today, and what would you like to change about your
                work? (optional)
              </label>
              <textarea
                id="bg"
                value={state.background}
                onChange={(e) => update({ background: e.target.value })}
                placeholder="e.g. I handle chat tickets for a SaaS product and want fewer repetitive calls…"
              />
              <VoiceButton
                onTranscript={(t) =>
                  update({
                    background: state.background
                      ? `${state.background.trim()} ${t}`.trim()
                      : t,
                  })
                }
              />
              <p className="muted">
                This release focuses on Customer Success vs Support Operations. If
                you want a different occupation, you can still continue and treat
                this as a trial of these two ways of working.
              </p>
              <div className="actions">
                <button className="btn" onClick={() => update({ step: "scenario" })}>
                  Continue
                </button>
                <button
                  className="btn secondary"
                  onClick={() => update({ background: "", step: "scenario" })}
                >
                  Skip
                </button>
              </div>
            </>
          )}

          {state.step === "scenario" && (
            <>
              <h1>Same problem. Two jobs.</h1>
              <p>
                <strong>Customer Success:</strong> What would you say to the shop
                owner who runs payroll tomorrow? Write the short message you would
                actually send.
              </p>
              <p>
                <strong>Support Operations:</strong> What would you investigate
                first, and what result would tell you whether your change helped?
              </p>
              <div className="actions">
                <button className="btn" onClick={() => update({ step: "cs-task" })}>
                  Start with Customer Success
                </button>
              </div>
            </>
          )}

          {state.step === "cs-task" && (
            <>
              <h1>Customer Success</h1>
              <div className="composer">
                <label className="label" htmlFor="cs">
                  Message to the shop owner who runs payroll tomorrow
                </label>
                <textarea
                  id="cs"
                  value={state.csAnswer}
                  onChange={(e) => update({ csAnswer: e.target.value })}
                  placeholder="Acknowledge urgency, ask one useful question, give a feasible next step or update time…"
                />
              </div>
              <VoiceButton
                onTranscript={(t) =>
                  update({
                    csAnswer: state.csAnswer
                      ? `${state.csAnswer.trim()} ${t}`.trim()
                      : t,
                  })
                }
              />
              <div className="actions">
                <button
                  className="btn"
                  disabled={!state.csAnswer.trim()}
                  onClick={() => update({ step: "ops-task" })}
                >
                  Next: Support Operations
                </button>
              </div>
            </>
          )}

          {state.step === "ops-task" && (
            <>
              <h1>Support Operations</h1>
              <div className="card-obs">
                <strong>Your message to the shop owner</strong>
                <p className="quote">{state.csAnswer}</p>
                <p>Now switch seats. Six shops mentioned the date format. What would you check before telling the owner that changing it will fix the upload?</p>
                {firstNote ? <p aria-live="polite">{firstNote}</p> : (
                  <button className="btn secondary" disabled={busy} onClick={async () => {
                    const result = await callCoach({
                      mode: "followup", background: state.background, csAnswer: state.csAnswer,
                      message: "Give one specific coaching observation about my customer message, then one concrete investigation question that follows from it. The incident: " + INCIDENT
                    });
                    if (result?.reply) setFirstNote(result.reply);
                  }}>{busy ? "Reading your answer…" : "Get feedback on my first answer"}</button>
                )}
                {error && <p role="alert">{error}</p>}
              </div>
              <div className="note">
                <label className="label" htmlFor="ops">
                  Investigation note
                </label>
                <textarea
                  id="ops"
                  value={state.opsAnswer}
                  onChange={(e) => update({ opsAnswer: e.target.value })}
                  placeholder="What you would check first, and what result would show whether the change helped…"
                />
              </div>
              <VoiceButton
                onTranscript={(t) =>
                  update({
                    opsAnswer: state.opsAnswer
                      ? `${state.opsAnswer.trim()} ${t}`.trim()
                      : t,
                  })
                }
              />
              <div className="actions">
                <button
                  className="btn"
                  disabled={!state.opsAnswer.trim() || busy}
                  onClick={() => update({ step: "preference" })}
                >
                  Continue
                </button>
              </div>
            </>
          )}

          {state.step === "preference" && (
            <>
              <h1>Which task would you rather do again?</h1>
              <div className="choice">
                {(
                  [
                    ["help_customer", "Help the customer"],
                    ["investigate_pattern", "Investigate the pattern"],
                    ["unsure", "Unsure"],
                  ] as [Preference, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={state.preference === value ? "selected" : ""}
                    onClick={() => update({ preference: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="actions">
                <button
                  className="btn"
                  disabled={!state.preference || busy}
                  onClick={() => void runCompare()}
                >
                  {busy ? "Getting live feedback…" : "Get live feedback"}
                </button>
              </div>
              {error ? (
                <p className="error">
                  {error}{" "}
                  <button className="btn secondary" onClick={() => void runCompare()}>
                    Retry
                  </button>
                </p>
              ) : null}
            </>
          )}

          {state.step === "compare" && state.compareFeedback && (
            <>
              <h1>What your answers suggest</h1>
              <div className="feedback">
                <div className="card-obs cs">
                  <strong>Customer Success</strong>
                  <p>{state.compareFeedback.csObservation}</p>
                  {state.compareFeedback.csQuote ? (
                    <p className="quote">“{state.compareFeedback.csQuote}”</p>
                  ) : null}
                  <div className="user-words">{state.csAnswer}</div>
                </div>
                <div className="card-obs ops">
                  <strong>Support Operations</strong>
                  <p>{state.compareFeedback.opsObservation}</p>
                  {state.compareFeedback.opsQuote ? (
                    <p className="quote">“{state.compareFeedback.opsQuote}”</p>
                  ) : null}
                  <div className="user-words">{state.opsAnswer}</div>
                </div>
                <div className="card-obs">
                  <strong>Preference & background</strong>
                  <p>{state.compareFeedback.preferenceNote}</p>
                </div>
                <div className="card-obs">
                  <strong>Gap to test</strong>
                  <p>{state.compareFeedback.gap}</p>
                  <p className="muted">{state.compareFeedback.testIdea}</p>
                </div>
              </div>

              <h2 style={{ marginTop: 18 }}>Explore a role</h2>
              <div className="actions">
                <button
                  className="btn"
                  onClick={() =>
                    update({ chosenRole: "customer_success", step: "exercise" })
                  }
                >
                  Explore Customer Success
                </button>
                <button
                  className="btn secondary"
                  onClick={() =>
                    update({ chosenRole: "support_operations", step: "exercise" })
                  }
                >
                  Explore Support Operations
                </button>
              </div>

              <h2 style={{ marginTop: 22 }}>Challenge this advice</h2>
              <p className="muted">
                Disagree, correct your preference, or ask a follow-up in your own
                words.
              </p>
              <div className="chat">
                {state.conversation.map((m, i) => (
                  <div key={`${m.at}-${i}`} className={`bubble ${m.role}`}>
                    {m.content}
                  </div>
                ))}
              </div>
              <textarea
                disabled={busy}
                value={followup}
                onChange={(e) => setFollowup(e.target.value)}
                placeholder='e.g. “I’m good at talking to customers, but I want fewer customer calls.”'
              />
              <VoiceButton
                onTranscript={(t) =>
                  setFollowup((prev) => (prev ? `${prev.trim()} ${t}`.trim() : t))
                }
                disabled={busy}
              />
              <div className="actions">
                <button
                  className="btn"
                  disabled={!followup.trim() || busy}
                  onClick={() => void sendFollowup()}
                >
                  {busy ? "Thinking…" : "Send"}
                </button>
              </div>
              {error ? (
                <p className="error">
                  {error}{" "}
                  <button className="btn secondary" onClick={() => void sendFollowup()}>
                    Retry
                  </button>
                </p>
              ) : null}
              {state.chosenRole ? (
                <p className="ok">
                  Current direction saved:{" "}
                  {state.chosenRole === "customer_success"
                    ? "Customer Success"
                    : "Support Operations"}
                </p>
              ) : null}
            </>
          )}

          {state.step === "exercise" && state.chosenRole && (
            <>
              <h1>
                {state.chosenRole === "customer_success"
                  ? "Customer Success exercise"
                  : "Support Operations exercise"}
              </h1>
              <p>
                {state.chosenRole === "customer_success"
                  ? "Draft a follow-up after the owner sends an error message. Include a next action and an update time."
                  : "Design a test of a date-format hint. Name the change, a measure, and one result that would weaken the hypothesis."}
              </p>
              <div className="choice">
                <button
                  type="button"
                  className={state.exerciseDuration === 5 ? "selected" : ""}
                  onClick={() => update({ exerciseDuration: 5 })}
                >
                  5-minute version — one clear deliverable
                </button>
                <button
                  type="button"
                  className={state.exerciseDuration === 10 ? "selected" : ""}
                  onClick={() => update({ exerciseDuration: 10 })}
                >
                  10-minute version — adds{" "}
                  {state.chosenRole === "customer_success"
                    ? "a temporary workaround without promising a verified root cause"
                    : "a sample size or time window"}
                </button>
              </div>
              <label className="label" htmlFor="ex" style={{ marginTop: 12 }}>
                Your draft
              </label>
              <textarea
                id="ex"
                value={state.exerciseDraft}
                onChange={(e) => update({ exerciseDraft: e.target.value })}
                placeholder="Write your draft here…"
              />
              <VoiceButton
                onTranscript={(t) =>
                  update({
                    exerciseDraft: state.exerciseDraft
                      ? `${state.exerciseDraft.trim()} ${t}`.trim()
                      : t,
                  })
                }
                disabled={busy}
              />
              {state.exerciseVersions.length > 0 ? (
                <div className="versions">
                  <strong>Earlier versions on this device</strong>
                  {state.exerciseVersions.map((v) => (
                    <div key={v.id} className="version">
                      <div className="user-words">{v.text}</div>
                      {v.feedback ? <p className="muted">{v.feedback}</p> : null}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="actions">
                <button
                  className="btn"
                  disabled={!state.exerciseDraft.trim() || busy}
                  onClick={() => void submitExercise()}
                >
                  {busy ? "Getting feedback…" : "Submit for live feedback"}
                </button>
                <button
                  className="btn secondary"
                  onClick={() => update({ step: "compare" })}
                >
                  Back to comparison
                </button>
              </div>
              {error ? (
                <p className="error">
                  {error}{" "}
                  <button
                    className="btn secondary"
                    onClick={() => void submitExercise()}
                  >
                    Retry
                  </button>
                </p>
              ) : null}
            </>
          )}

          {state.step === "done" && (
            <>
              <h1>Your next step</h1>
              <p className="lede">
                Read the feedback below. Try one change to your draft, or revisit how the two roles felt. Your work is saved on this device.
              </p>
              {state.exerciseVersions.slice(-1).map((v) => (
                <div key={v.id}>
                  <div className="user-words">{v.text}</div>
                  <p>{v.feedback}</p>
                </div>
              ))}
              <div className="actions">
                <button
                  className="btn"
                  onClick={() => update({ step: "exercise" })}
                >
                  Revise draft
                </button>
                <button className="btn secondary" onClick={() => update({ step: "compare" })}>
                  Revisit my role choice
                </button>
              </div>
            </>
          )}

          <div className="status-row">
            <span className={savedFlash ? "ok" : "muted"}>
              {savedFlash ? "Saved on this device" : "Progress stays on this device"}
            </span>
            {state.step !== "home" ? (
              <button className="btn ghost" onClick={resetAll}>
                Reset
              </button>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
