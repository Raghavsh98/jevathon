"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clamp01, type JevScore } from "@/lib/perspectives";

type Point = { x: number; y: number };

type Props = {
  /** Where the user wants the answer to stand. Null until there is an answer. */
  puck: Point | null;
  /** Where Jev says the current answer stands. Only gates dragging. */
  jev: JevScore | null;
  busy: boolean;
  onMove: (point: Point) => void;
  onRelease: (point: Point) => void;
};

// Axis space has spiritual at the top, so y is flipped for rendering.
const top = (y: number) => `${(1 - y) * 100}%`;
const left = (x: number) => `${x * 100}%`;

export default function Plane({ puck, jev, busy, onMove, onRelease }: Props) {
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

      {/* the puck is the only thing on the plane; Jev's own score and the
          radius it has to land in stay in the chat, not drawn over the grid */}
      {puck && (
        <span
          className="pointer-events-none absolute block h-[33px] w-[33px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: left(puck.x),
            top: top(puck.y),
            backgroundImage:
              "linear-gradient(in oklab 207.29deg, oklab(73.9% 0 0) 35.79%, oklab(100% 0 0) 141.48%)",
            boxShadow: "#FFFFFF33 0px 2px 0px inset",
            outline: "4px solid #F2F2F2",
            transition: dragging ? "none" : "left 220ms ease, top 220ms ease",
          }}
        />
      )}
    </div>
  );
}
