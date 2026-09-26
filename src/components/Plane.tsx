"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clamp01, type JevScore } from "@/lib/perspectives";

type Point = { x: number; y: number };

type Props = {
  /** Where the user wants the answer to stand. Null until there is an answer. */
  puck: Point | null;
  /** Where Jev says the current answer actually stands. */
  jev: JevScore | null;
  radius: number;
  busy: boolean;
  onMove: (point: Point) => void;
  onRelease: (point: Point) => void;
};

// Axis space has spiritual at the top, so y is flipped for rendering.
const top = (y: number) => `${(1 - y) * 100}%`;
const left = (x: number) => `${x * 100}%`;

export default function Plane({
  puck,
  jev,
  radius,
  busy,
  onMove,
  onRelease,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  // The last point the pointer produced; onRelease needs it without waiting
  // for a re-render.
  const latest = useRef<Point>({ x: 0.5, y: 0.5 });

  const pointAt = useCallback((clientX: number, clientY: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01(1 - (clientY - rect.top) / rect.height),
    };
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onPointerMove = (event: PointerEvent) => {
      const point = pointAt(event.clientX, event.clientY);
      if (!point) return;
      latest.current = point;
      onMove(point);
    };
    const onPointerUp = () => {
      setDragging(false);
      onRelease(latest.current);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [dragging, onMove, onRelease, pointAt]);

  const live = puck !== null && jev !== null;
  const gap = live ? Math.hypot(puck.x - jev.x, puck.y - jev.y) : 0;
  const hit = gap <= radius;

  return (
    <div
      ref={ref}
      onPointerDown={(event) => {
        if (busy || !live) return;
        event.preventDefault();
        const point = pointAt(event.clientX, event.clientY);
        if (!point) return;
        latest.current = point;
        onMove(point);
        setDragging(true);
      }}
      className="relative aspect-square w-full touch-none select-none rounded-lg border border-[var(--line-strong)]"
      style={{
        cursor: !live
          ? "default"
          : busy
            ? "progress"
            : dragging
              ? "grabbing"
              : "grab",
        opacity: busy ? 0.7 : 1,
        transition: "opacity 200ms ease",
      }}
    >
      <div className="pointer-events-none absolute inset-0 grid grid-cols-4 grid-rows-4 overflow-hidden rounded-lg">
        {Array.from({ length: 16 }, (_, index) => (
          <div key={index} className="border-[0.5px] border-[var(--line)]" />
        ))}
      </div>

      {/* the gap Jev still has to close */}
      {jev && puck && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          <line
            x1={left(jev.x)}
            y1={top(jev.y)}
            x2={left(puck.x)}
            y2={top(puck.y)}
            stroke="var(--line-strong)"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity={hit ? 0 : 1}
            style={{ transition: "opacity 300ms ease" }}
          />
        </svg>
      )}

      {/* where Jev placed the answer */}
      {jev && (
      <div
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
        style={{
          left: left(jev.x),
          top: top(jev.y),
          transition: "left 400ms ease, top 400ms ease",
        }}
      >
        <span
          className="block h-2.5 w-2.5 rounded-full bg-[var(--foreground)]"
          style={{
            opacity: 0.35 + 0.65 * jev.confidence,
            filter: `blur(${(1 - jev.confidence) * 2.5}px)`,
          }}
        />
        {jev.hedging && (
          <span className="absolute left-4 top-1/2 -translate-y-1/2 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--faint)]">
            hedging
          </span>
        )}
      </div>
      )}

      {/* where the user wants it */}
      {puck && (
      <div
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border"
        style={{
          left: left(puck.x),
          top: top(puck.y),
          width: `${radius * 200}%`,
          height: `${radius * 200}%`,
          borderColor: hit ? "var(--foreground)" : "var(--line-strong)",
          background: hit ? "var(--fill)" : "transparent",
          transition: dragging
            ? "border-color 200ms ease, background 200ms ease"
            : "left 220ms ease, top 220ms ease, border-color 200ms ease, background 200ms ease",
        }}
      >
        <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--foreground)]" />
      </div>
      )}
    </div>
  );
}
