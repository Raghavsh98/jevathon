"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import Plane from "@/components/Plane";
import {
  POLITICAL_COMPASS,
  RADIUS,
  clamp01,
  type Frame,
  type JevScore,
} from "@/lib/perspectives";

export type Answer = { voice: string; text: string };
export type Point = { x: number; y: number };

type Turn =
  | { kind: "question"; text: string }
  | { kind: "answer"; answer: Answer; jev: JevScore; gap?: number; hit?: boolean }
  | { kind: "note"; text: string };

type Event = {
  type: "answer" | "frame" | "nudging" | "done" | "error";
  attempt?: number;
  frame?: Frame;
  answer?: Answer;
  jev?: JevScore;
  gap?: number;
  hit?: boolean;
  error?: string;
};

async function* readEvents(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) yield JSON.parse(line) as Event;
  }
}

export default function PerspectiveMachine() {
  const feedRef = useRef<HTMLDivElement>(null);

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [jev, setJev] = useState<JevScore | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  // "compass" plots on the Political Compass everyone knows; "auto" lets the
  // model draw a plane for the question it was actually asked.
  const [mode, setMode] = useState<"compass" | "auto">("compass");
  const [puck, setPuck] = useState<Point | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // What the loop is doing right now, shown as a placeholder answer.
  const [stage, setStage] = useState<{ label: string; attempt: number } | null>(
    null,
  );
  // Lets the user call off the loop mid-nudge and keep what is on screen.
  const running = useRef<AbortController | null>(null);

  useEffect(() => {
    feedRef.current?.scrollTo({
      top: feedRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, note, stage]);

  const run = useCallback(
    async (body: object, nextQuestion: string) => {
      const controller = new AbortController();
      running.current = controller;
      setBusy(true);
      setNote(null);
      setStage({ label: "Writing an answer", attempt: 0 });
      try {
        const response = await fetch("/api/steer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await response.text());

        for await (const event of readEvents(response)) {
          if (event.type === "frame" && event.frame) {
            const { schools, framework, x, y } = event.frame;
            setFrame(event.frame);
            setTurns((current) => [
              ...current,
              {
                kind: "note",
                text: [
                  framework
                    ? `Framework: ${framework}`
                    : schools.length
                      ? `Schools of thought: ${schools.join(", ")}`
                      : "",
                  `Axes: ${x.min} ↔ ${x.max} · ${y.min} ↔ ${y.max}`,
                ]
                  .filter(Boolean)
                  .join("\n"),
              },
            ]);
            setStage({ label: "Jev is placing the answer", attempt: 0 });
          }
          if (event.type === "nudging") {
            setStage({
              label:
                event.attempt === 1
                  ? "Rewriting toward the puck"
                  : "Not there yet, rewriting again",
              attempt: event.attempt ?? 0,
            });
          }
          if (event.type === "answer" && event.answer && event.jev) {
            setAnswer(event.answer);
            setJev(event.jev);
            setQuestion(nextQuestion);
            if (event.attempt === 0) setPuck({ x: event.jev.x, y: event.jev.y });
            const { answer: got, jev: scored, gap, hit } = event;
            setTurns((current) => [
              ...current,
              { kind: "answer", answer: got, jev: scored, gap, hit },
            ]);
            setNote(null);
            setStage(
              hit === false ? { label: "Jev is re-reading it", attempt: 0 } : null,
            );
          }
          if (event.type === "done" && event.hit === false) {
            setNote(
              `Closest it got was ${event.gap} away — the puck is asking for a position the model will not hold.`,
            );
          }
          if (event.type === "error") setNote(event.error ?? "Something broke");
        }
      } catch (error) {
        if (controller.signal.aborted) setNote("Stopped");
        else setNote(error instanceof Error ? error.message : "Something broke");
      } finally {
        running.current = null;
        setStage(null);
        setBusy(false);
      }
    },
    [],
  );

  const stop = useCallback(() => {
    running.current?.abort();
  }, []);

  const ask = useCallback(() => {
    const asked = draft.trim();
    if (!asked || busy) return;
    setDraft("");
    setTurns((current) => [...current, { kind: "question", text: asked }]);
    const chosen = mode === "compass" ? POLITICAL_COMPASS : null;
    // A new question gets its own axes, so the old frame is dropped.
    setFrame(chosen);
    setJev(null);
    setPuck(null);
    void run(
      chosen ? { question: asked, frame: chosen } : { question: asked },
      asked,
    );
  }, [busy, draft, mode, run]);

  const steer = useCallback(
    (target: Point) => {
      if (busy || !answer || !jev || !frame) return;
      void run(
        {
          question,
          frame,
          answer,
          at: { x: jev.x, y: jev.y },
          target,
        },
        question,
      );
    },
    [answer, busy, frame, jev, question, run],
  );

  // In compass mode the plane is known before anything is asked.
  const shown = frame ?? (mode === "compass" ? POLITICAL_COMPASS : null);
  // How far the answer on screen still is from where the puck sits.
  const gap =
    jev && puck ? Math.hypot(jev.x - puck.x, jev.y - puck.y) : null;

  return (
    <main className="flex h-dvh w-full flex-col overflow-hidden lg:flex-row">
      <section className="flex min-h-0 w-full flex-col border-b border-[var(--line)] bg-[var(--panel)] lg:w-[46%] lg:max-w-[600px] lg:border-b-0 lg:border-r">
        <header className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
          <div className="flex items-baseline gap-2">
            <h1 className="text-[13px] font-medium tracking-tight">
              Perspective Machine
            </h1>
            {jev?.model && (
              <span className="font-mono text-[11px] text-[var(--faint)]">
                {jev.model}
              </span>
            )}
          </div>
          <ThemeToggle />
        </header>

        <div
          ref={feedRef}
          className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-6"
        >
          {turns.length === 0 && !note && !stage && (
            <p className="m-auto max-w-[34ch] text-center text-[14px] leading-relaxed text-[var(--faint)]">
              {mode === "compass"
                ? "Ask anything. The answer gets plotted on the Political Compass, and you can drag it somewhere else."
                : "Ask anything. The model works out what people disagree about in your question, and those become the axes of the plane."}
            </p>
          )}

          {turns.map((turn, index) =>
            turn.kind === "question" ? (
              <div key={index} className="flex justify-end">
                <p className="max-w-[80%] rounded-2xl rounded-br-md bg-[var(--bubble)] px-4 py-2.5 text-[14px] leading-relaxed">
                  {turn.text}
                </p>
              </div>
            ) : turn.kind === "note" ? (
              <p
                key={index}
                className="whitespace-pre-line font-mono text-[11px] leading-relaxed text-[var(--faint)]"
              >
                {turn.text}
              </p>
            ) : (
              <div key={index}>
                <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]">
                  {turn.answer.voice}
                </p>
                <p className="max-w-[48ch] text-[15px] leading-[1.75]">
                  {turn.answer.text}
                </p>
                <p className="mt-3 font-mono text-[11px] leading-relaxed text-[var(--faint)]">
                  jev {turn.jev.x.toFixed(2)}, {turn.jev.y.toFixed(2)} ·
                  confidence {Math.round(turn.jev.confidence * 100)}%
                  {turn.jev.hedging ? " · hedging" : ""}
                  {turn.gap !== undefined
                    ? turn.hit
                      ? " · inside the puck"
                      : ` · ${turn.gap} away`
                    : ""}
                </p>
              </div>
            ),
          )}

          {stage && (
            <div className="animate-pulse">
              <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]">
                {stage.label}
                {stage.attempt > 0 ? ` · nudge ${stage.attempt} of 6` : ""}
              </p>
              <div className="max-w-[48ch] space-y-2.5">
                <div className="h-3 w-full rounded-full bg-[var(--bubble)]" />
                <div className="h-3 w-[92%] rounded-full bg-[var(--bubble)]" />
                <div className="h-3 w-[64%] rounded-full bg-[var(--bubble)]" />
              </div>
              {stage.attempt > 0 && gap !== null && (
                <p className="mt-3 font-mono text-[11px] text-[var(--faint)]">
                  {gap.toFixed(2)} from the puck
                </p>
              )}
            </div>
          )}

          {note && (
            <p className="font-mono text-[11px] text-[var(--faint)]">{note}</p>
          )}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) stop();
            else ask();
          }}
          className="border-t border-[var(--line)] px-6 py-4"
        >
          <div className="flex items-end gap-2 rounded-xl border border-[var(--line-strong)] bg-[var(--background)] px-3 py-2 transition-colors focus-within:border-[var(--foreground)]">
            <textarea
              rows={1}
              value={draft}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  ask();
                }
              }}
              placeholder="Ask a question…"
              className="max-h-28 flex-1 resize-none bg-transparent py-1 text-[14px] leading-relaxed outline-none placeholder:text-[var(--faint)] disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!busy && !draft.trim()}
              className="rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-[12px] font-medium text-[var(--background)] transition-opacity disabled:opacity-30"
            >
              {busy ? "Stop" : "Ask"}
            </button>
          </div>
          {answer && (
            <p className="mt-2 font-mono text-[11px] text-[var(--faint)]">
              Drag the puck to move the answer. Jev decides when it has arrived.
            </p>
          )}
        </form>
      </section>

      <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 p-8 lg:p-12">
        <div className="flex rounded-lg border border-[var(--line-strong)] p-0.5">
          {(
            [
              ["compass", "Political compass"],
              ["auto", "Create your own"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              disabled={busy}
              onClick={() => {
                if (value === mode) return;
                setMode(value);
                // The old plane means nothing on the new one.
                setFrame(null);
                setJev(null);
                setPuck(null);
              }}
              className={`rounded-md px-3 py-1.5 text-[12px] transition-colors disabled:opacity-40 ${
                mode === value
                  ? "bg-[var(--foreground)] text-[var(--background)]"
                  : "text-[var(--faint)] hover:text-[var(--foreground)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="w-full max-w-[540px] font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]">
          <p className="mb-3 text-center">{shown?.y.max ?? ""}</p>

          <div className="flex items-center gap-3">
            <span className="w-[10ch] text-right">{shown?.x.min ?? ""}</span>
            <div className="min-w-0 flex-1">
              <Plane
                puck={puck}
                jev={jev}
                radius={RADIUS}
                busy={busy}
                onMove={(point) =>
                  setPuck({ x: clamp01(point.x), y: clamp01(point.y) })
                }
                onRelease={steer}
              />
            </div>
            <span className="w-[10ch]">{shown?.x.max ?? ""}</span>
          </div>

          <p className="mt-3 text-center">{shown?.y.min ?? ""}</p>
          <p className="mt-2 text-center normal-case tracking-normal">
            {puck ? `puck ${puck.x.toFixed(2)}, ${puck.y.toFixed(2)}` : ""}
          </p>
        </div>
      </section>
    </main>
  );
}
