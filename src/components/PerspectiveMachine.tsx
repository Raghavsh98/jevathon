"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GRID,
  clamp01,
  nearestCell,
  perspectives,
  type Cell,
} from "@/lib/perspectives";

const START = { x: 0.5, y: 0.5 };

function confidenceStyle(confidence: number) {
  return {
    opacity: 0.35 + 0.65 * confidence,
    filter: `blur(${(1 - confidence) * 3.2}px)`,
  };
}

export default function PerspectiveMachine() {
  const gridRef = useRef<HTMLDivElement>(null);
  const fadeTimer = useRef<number | null>(null);
  const targetId = useRef(nearestCell(START.x, START.y).id);
  const [puck, setPuck] = useState(START);
  const [dragging, setDragging] = useState(false);
  const [active, setActive] = useState<Cell>(() =>
    nearestCell(START.x, START.y),
  );
  const [visible, setVisible] = useState(true);

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
      crossfadeTo(nearestCell(next.x, next.y));
    },
    [crossfadeTo],
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

  const { axes } = perspectives;

  return (
    <main className="flex h-dvh w-full flex-col items-center justify-center gap-10 px-8 py-10 lg:flex-row lg:gap-20">
      <section className="flex w-full max-w-[520px] flex-col items-center">
        <div className="mb-4 flex w-full items-baseline justify-between text-[11px] uppercase tracking-[0.28em] text-[var(--muted)]">
          <span>{axes.x.min}</span>
          <span className="text-[var(--accent)]">{axes.y.max}</span>
          <span>{axes.x.max}</span>
        </div>

        <div
          ref={gridRef}
          onPointerDown={(event) => {
            event.preventDefault();
            setDragging(true);
            moveTo(event.clientX, event.clientY);
          }}
          className="relative aspect-square w-full cursor-grab touch-none select-none rounded-[2px] border border-[var(--line)] active:cursor-grabbing"
        >
          <div className="grid h-full w-full grid-cols-4 grid-rows-4">
            {perspectives.cells
              .slice()
              .sort((a, b) => a.row - b.row || a.col - b.col)
              .map((cell) => {
                const isActive = cell.id === active.id;
                return (
                  <div
                    key={cell.id}
                    className="relative flex items-end border-[0.5px] border-[var(--line)] p-2 transition-colors duration-300"
                    style={{
                      backgroundColor: isActive
                        ? "rgba(232, 194, 106, 0.09)"
                        : "transparent",
                    }}
                  >
                    <span
                      className="text-[10px] leading-tight tracking-wide text-[var(--muted)] transition-all duration-300"
                      style={confidenceStyle(cell.jev.confidence)}
                    >
                      {cell.voice}
                    </span>
                    {cell.jev.hedging && (
                      <span
                        className="absolute right-2 top-2 h-1 w-1 rounded-full bg-[var(--muted)]"
                        title="Jev flagged this answer as hedging"
                      />
                    )}
                  </div>
                );
              })}
          </div>

          <div
            className="pointer-events-none absolute h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--accent)] bg-[rgba(232,194,106,0.14)] backdrop-blur-[2px]"
            style={{
              left: `${puck.x * 100}%`,
              top: `${puck.y * 100}%`,
              transition: dragging ? "none" : "left 220ms ease, top 220ms ease",
              boxShadow: "0 0 26px rgba(232, 194, 106, 0.35)",
            }}
          >
            <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)]" />
          </div>
        </div>

        <div className="mt-4 flex w-full items-baseline justify-center text-[11px] uppercase tracking-[0.28em] text-[var(--accent)]">
          <span>{axes.y.min}</span>
        </div>
      </section>

      <section className="flex w-full max-w-[460px] flex-col">
        <p className="text-[11px] uppercase tracking-[0.28em] text-[var(--muted)]">
          {perspectives.question}
        </p>

        <div
          className="mt-6 transition-opacity duration-150"
          style={{ opacity: visible ? 1 : 0 }}
        >
          <p className="text-[11px] uppercase tracking-[0.28em] text-[var(--accent)]">
            {active.voice}
          </p>
          <p
            className="mt-4 text-[17px] leading-[1.7] transition-all duration-300"
            style={confidenceStyle(active.jev.confidence)}
          >
            {active.text}
          </p>
          <p className="mt-6 text-[11px] tracking-[0.2em] text-[var(--muted)]">
            {axes.x.min}/{axes.x.max} {active.jev.x.toFixed(2)} &nbsp;·&nbsp;{" "}
            {axes.y.min}/{axes.y.max} {active.jev.y.toFixed(2)} &nbsp;·&nbsp;
            confidence {Math.round(active.jev.confidence * 100)}%
            {active.jev.hedging ? " · hedging" : ""}
          </p>
        </div>
      </section>
    </main>
  );
}
