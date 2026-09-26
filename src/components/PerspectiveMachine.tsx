"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import {
  GRID,
  clamp01,
  nearestCell,
  precomputed,
  type Cell,
  type Perspectives,
} from "@/lib/perspectives";

const START = { x: 0.5, y: 0.5 };

// Jev's confidences sit in a narrow band, so stretch them across that band's
// own range - otherwise every cell renders equally washed out and the
// difference between a sure answer and an unsure one stops being visible.
function confidenceScale(cells: Cell[]) {
  const values = cells.map((cell) => cell.jev.confidence);
  const low = Math.min(...values);
  const high = Math.max(...values);
  return (confidence: number) =>
    high === low ? 1 : (confidence - low) / (high - low);
}

export default function PerspectiveMachine() {
  const gridRef = useRef<HTMLDivElement>(null);
  const fadeTimer = useRef<number | null>(null);
  const targetId = useRef<string | null>(
    nearestCell(precomputed.cells, START.x, START.y).id,
  );

  const [set, setSet] = useState<Perspectives>(precomputed);
  const [puck, setPuck] = useState(START);
  const [dragging, setDragging] = useState(false);
  const [active, setActive] = useState<Cell>(() =>
    nearestCell(precomputed.cells, START.x, START.y),
  );
  const [visible, setVisible] = useState(true);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const certainty = useMemo(() => confidenceScale(set.cells), [set]);
  const sharp = certainty(active.jev.confidence);

  const crossfadeTo = useCallback((next: Cell) => {
    if (targetId.current === next.id) return;
    targetId.current = next.id;
    if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
    setVisible(false);
    fadeTimer.current = window.setTimeout(() => {
      setActive(next);
      setVisible(true);
    }, 140);
  }, []);

  const placePuck = useCallback(
    (x: number, y: number) => {
      const next = { x: clamp01(x), y: clamp01(y) };
      setPuck(next);
      crossfadeTo(nearestCell(set.cells, next.x, next.y));
    },
    [crossfadeTo, set],
  );

  const moveTo = useCallback(
    (clientX: number, clientY: number) => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return;
      placePuck(
        (clientX - rect.left) / rect.width,
        (clientY - rect.top) / rect.height,
      );
    },
    [placePuck],
  );

  useEffect(
    () => () => {
      if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => moveTo(event.clientX, event.clientY);
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, moveTo]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /input|textarea/i.test(target.tagName)) return;
      const step = 1 / GRID;
      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const delta = deltas[event.key];
      if (!delta) return;
      event.preventDefault();
      placePuck(puck.x + delta[0], puck.y + delta[1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placePuck, puck]);

  const ask = useCallback(async () => {
    const question = draft.trim();
    if (!question || status) return;
    setError(null);
    setStatus("Writing sixteen perspectives, then scoring them with Jev");
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Generation failed");
      const next = body as Perspectives;
      setSet(next);
      targetId.current = null;
      setPuck(START);
      setActive(nearestCell(next.cells, START.x, START.y));
      targetId.current = nearestCell(next.cells, START.x, START.y).id;
      setVisible(true);
      setDraft("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Generation failed");
    } finally {
      setStatus(null);
    }
  }, [draft, status]);

  const { axes } = set;

  return (
    <main className="flex h-dvh w-full flex-col overflow-hidden lg:flex-row">
      {/* left: the chat */}
      <section className="flex min-h-0 w-full flex-col border-b border-[var(--line)] bg-[var(--panel)] lg:w-[46%] lg:max-w-[620px] lg:border-b-0 lg:border-r">
        <header className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
          <div className="flex items-baseline gap-2">
            <h1 className="text-[13px] font-medium tracking-tight">
              Perspective Machine
            </h1>
            <span className="font-mono text-[11px] text-[var(--faint)]">
              {set.model}
            </span>
          </div>
          <ThemeToggle />
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
          <div className="flex justify-end">
            <p className="max-w-[80%] rounded-2xl rounded-br-md bg-[var(--bubble)] px-4 py-2.5 text-[14px] leading-relaxed">
              {set.question}
            </p>
          </div>

          <div
            className="transition-opacity duration-150"
            style={{ opacity: visible ? 1 : 0 }}
          >
            <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]">
              {active.voice}
            </p>
            <p
              className="max-w-[46ch] text-[15px] leading-[1.75] transition-all duration-300"
              style={{
                opacity: 0.72 + 0.28 * sharp,
                filter: `blur(${(1 - sharp) * 0.9}px)`,
              }}
            >
              {active.text}
            </p>
            <p className="mt-4 font-mono text-[11px] leading-relaxed text-[var(--faint)]">
              {axes.x.min}/{axes.x.max} {active.jev.x.toFixed(2)} ·{" "}
              {axes.y.min}/{axes.y.max} {active.jev.y.toFixed(2)} · confidence{" "}
              {Math.round(active.jev.confidence * 100)}%
              {active.jev.hedging ? " · hedging" : ""}
            </p>
          </div>

          {status && (
            <p className="animate-pulse font-mono text-[11px] text-[var(--faint)]">
              {status}…
            </p>
          )}
          {error && (
            <p className="font-mono text-[11px] text-[var(--foreground)]">
              {error}
            </p>
          )}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void ask();
          }}
          className="border-t border-[var(--line)] px-6 py-4"
        >
          <div className="flex items-end gap-2 rounded-xl border border-[var(--line-strong)] bg-[var(--background)] px-3 py-2 transition-colors focus-within:border-[var(--foreground)]">
            <textarea
              rows={1}
              value={draft}
              disabled={Boolean(status)}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask();
                }
              }}
              placeholder="Ask a question…"
              className="max-h-28 flex-1 resize-none bg-transparent py-1 text-[14px] leading-relaxed outline-none placeholder:text-[var(--faint)] disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={Boolean(status) || !draft.trim()}
              className="rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-[12px] font-medium text-[var(--background)] transition-opacity disabled:opacity-30"
            >
              {status ? "Thinking" : "Ask"}
            </button>
          </div>
          <p className="mt-2 font-mono text-[11px] text-[var(--faint)]">
            A new question writes and scores sixteen answers — takes a moment.
          </p>
        </form>
      </section>

      {/* right: the grid */}
      <section className="flex min-h-0 flex-1 items-center justify-center p-8 lg:p-12">
        <div className="w-full max-w-[560px]">
          <div className="mb-3 flex items-baseline justify-between font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]">
            <span>{axes.x.min}</span>
            <span>{axes.y.max}</span>
            <span>{axes.x.max}</span>
          </div>

          <div
            ref={gridRef}
            onPointerDown={(event) => {
              event.preventDefault();
              setDragging(true);
              moveTo(event.clientX, event.clientY);
            }}
            className="relative aspect-square w-full cursor-grab touch-none select-none rounded-lg border border-[var(--line-strong)] active:cursor-grabbing"
          >
            <div className="grid h-full w-full grid-cols-4 grid-rows-4 overflow-hidden rounded-lg">
              {set.cells
                .slice()
                .sort((a, b) => a.row - b.row || a.col - b.col)
                .map((cell) => {
                  const cellSharp = certainty(cell.jev.confidence);
                  return (
                    <div
                      key={cell.id}
                      className="relative flex items-end border-[0.5px] border-[var(--line)] p-2 transition-colors duration-300"
                      style={{
                        background:
                          cell.id === active.id ? "var(--fill)" : "transparent",
                      }}
                    >
                      <span
                        className="text-[11px] leading-tight text-[var(--muted)] transition-all duration-300"
                        style={{
                          opacity: 0.4 + 0.6 * cellSharp,
                          filter: `blur(${(1 - cellSharp) * 2.2}px)`,
                        }}
                      >
                        {cell.voice}
                      </span>
                      {cell.jev.hedging && (
                        <span
                          className="absolute right-2 top-2 h-1 w-1 rounded-full bg-[var(--faint)]"
                          title="Jev flagged this answer as hedging"
                        />
                      )}
                    </div>
                  );
                })}
            </div>

            <div
              className="pointer-events-none absolute h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--foreground)] bg-[var(--background)]"
              style={{
                left: `${puck.x * 100}%`,
                top: `${puck.y * 100}%`,
                transition: dragging
                  ? "none"
                  : "left 220ms ease, top 220ms ease",
              }}
            >
              <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--foreground)]" />
            </div>
          </div>

          <div className="mt-3 flex justify-center font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]">
            <span>{axes.y.min}</span>
          </div>
        </div>
      </section>
    </main>
  );
}
