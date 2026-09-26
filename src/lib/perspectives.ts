export type JevScore = {
  x: number;
  y: number;
  hedging: boolean;
  confidence: number;
  /** Which Jev version scored it. */
  model?: string;
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

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
