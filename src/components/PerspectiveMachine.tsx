"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import Plane from "@/components/Plane";
import { AXES, RADIUS, clamp01, type JevScore } from "@/lib/perspectives";

export type Answer = { voice: string; text: string };
export type Point = { x: number; y: number };

type Turn =
  | { kind: "question"; text: string }
  | { kind: "answer"; answer: Answer; jev: JevScore; gap?: number; hit?: boolean }
  | { kind: "note"; text: string };

type Event = {
  type: "answer" | "nudging" | "done" | "error";
  attempt?: number;
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
  const [puck, setPuck] = useState<Point | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Lets the user call off the loop mid-nudge and keep what is on screen.
  const running = useRef<AbortController | null>(null);

  useEffect(() => {
    feedRef.current?.scrollTo({
      top: feedRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, note]);

  const run = useCallback(
    async (body: object, nextQuestion: string) => {
      const controller = new AbortController();
      running.current = controller;
      setBusy(true);
      setNote(null);
      try {
        const response = await fetch("/api/steer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await response.text());

        for await (const event of readEvents(response)) {
          if (event.type === "nudging") {
            setNote(
              event.attempt === 1
                ? "Rewriting toward the puck"
                : `Not there yet — nudge ${event.attempt}`,
            );
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
    void run({ question: asked }, asked);
  }, [busy, draft, run]);

  const steer = useCallback(
    (target: Point) => {
      if (busy || !answer || !jev) return;
      void run(
        {
          question,
          answer,
          at: { x: jev.x, y: jev.y },
          target,
        },
        question,
      );
    },
    [answer, busy, jev, question, run],
  );

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
          {turns.length === 0 && !note && (
            <p className="m-auto max-w-[32ch] text-center text-[14px] leading-relaxed text-[var(--faint)]">
              Ask anything. Jev will place the answer on the plane.
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
              <p key={index} className="font-mono text-[11px] text-[var(--faint)]">
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

          {note && (
            <p className="animate-pulse font-mono text-[11px] text-[var(--faint)]">
              {note}
            </p>
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

      <section className="flex min-h-0 flex-1 items-center justify-center p-8 lg:p-12">
        <div className="w-full max-w-[540px]">
          <div className="mb-3 flex items-baseline justify-between font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]">
            <span>{AXES.x.min}</span>
            <span>{AXES.y.max}</span>
            <span>{AXES.x.max}</span>
          </div>

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

          <div className="mt-3 flex items-baseline justify-between font-mono text-[11px] text-[var(--faint)]">
            <span className="uppercase tracking-[0.14em]">&nbsp;</span>
            <span className="uppercase tracking-[0.14em]">{AXES.y.min}</span>
            <span>
              {puck ? `puck ${puck.x.toFixed(2)}, ${puck.y.toFixed(2)}` : ""}
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
