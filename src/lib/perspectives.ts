import data from "@/data/responses.json";

export type JevScore = {
  x: number;
  y: number;
  hedging: boolean;
  confidence: number;
};

export type Axes = {
  x: { min: string; max: string };
  y: { min: string; max: string };
};

/** How close Jev's score has to land for the answer to count as arrived. */
export const RADIUS = 0.15;

export const AXES: Axes = {
  x: { min: "individual", max: "collective" },
  y: { min: "material", max: "spiritual" },
};

type Stored = {
  question: string;
  model: string;
  cells: { voice: string; text: string; jev: JevScore }[];
};

const stored = data as Stored;

/**
 * Something already on screen at load, with a real Jev score behind it, so the
 * plane is never empty before the first call.
 */
export const seed = {
  question: stored.question,
  model: stored.model,
  answer: { voice: stored.cells[9].voice, text: stored.cells[9].text },
  jev: stored.cells[9].jev,
};

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
