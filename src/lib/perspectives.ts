export type JevScore = {
  x: number;
  y: number;
  hedging: boolean;
  confidence: number;
  /** Which Jev version scored it. */
  model?: string;
};

/**
 * One side of the plane. `rubric` is the ladder Jev judges against - four
 * plain-English descriptions running from the min end to the max end.
 */
export type Axis = { min: string; max: string; rubric: string[] };

/**
 * The axes for one question. The model reaches for a known framework (the
 * Political Compass, Baumrind, attachment theory...) when one fits, and
 * otherwise builds axes out of the schools of thought the question splits
 * along - so every chat gets its own plane.
 */
export type Frame = {
  x: Axis;
  y: Axis;
  schools: string[];
  /** Empty when the model had to invent the axes. */
  framework: string;
};

/**
 * The Political Compass, as everyone already knows it: economics across,
 * social authority up. Used verbatim when the user picks that mode, so a
 * position here means the same thing it means anywhere else.
 */
export const POLITICAL_COMPASS: Frame = {
  framework: "The Political Compass",
  schools: [],
  x: {
    min: "left",
    max: "right",
    rubric: [
      "Far left economically: the state or the collective should own and run the economy; markets and private wealth are the problem.",
      "Centre-left: markets are kept, but heavily taxed and regulated to redistribute wealth and fund strong public services.",
      "Centre-right: markets lead and taxes stay low; the state provides a safety net and enforces the rules, little more.",
      "Far right economically: free markets and private property above all; taxation, welfare and regulation should be minimal or abolished.",
    ],
  },
  y: {
    min: "libertarian",
    max: "authoritarian",
    rubric: [
      "Strongly libertarian: individuals decide for themselves; the state has almost no business in personal conduct, speech or choices.",
      "Leaning libertarian: personal freedom is the default, with rules only where someone else is clearly harmed.",
      "Leaning authoritarian: order, tradition or public interest justify the state telling people how to behave in some areas.",
      "Strongly authoritarian: the state should enforce a shared moral or social order, with obedience valued over individual choice.",
    ],
  },
};

/** How close Jev's score has to land for the answer to count as arrived. */
export const RADIUS = 0.25;

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
