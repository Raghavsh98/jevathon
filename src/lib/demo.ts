import demo from "@/data/demo.json";
import type { Frame, JevScore } from "@/lib/perspectives";

export type DemoAnswer = { voice: string; text: string; jev: JevScore };

export type DemoSet = {
  id: string;
  mode: "compass" | "auto";
  question: string;
  frame: Frame;
  answers: DemoAnswer[];
};

const SETS = demo.sets as DemoSet[];

const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Words a question is about, minus the ones every question contains. */
const STOP = new Set([
  "a",
  "an",
  "and",
  "are",
  "be",
  "do",
  "does",
  "for",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "should",
  "than",
  "that",
  "the",
  "to",
  "we",
  "what",
  "you",
  "your",
]);

const keywords = (text: string) =>
  new Set(
    normalise(text)
      .split(" ")
      .filter((word) => word && !STOP.has(word)),
  );

/**
 * The prepared set for a question, if one covers it. Matching is loose on
 * purpose: on stage the question is retyped from memory, not pasted.
 */
export function findSet(question: string, mode: string): DemoSet | null {
  const asked = keywords(question);
  let best: { set: DemoSet; overlap: number } | null = null;
  for (const set of SETS) {
    if (set.mode !== mode) continue;
    const theirs = keywords(set.question);
    let shared = 0;
    for (const word of theirs) if (asked.has(word)) shared += 1;
    const overlap = shared / theirs.size;
    if (overlap >= 0.6 && (!best || overlap > best.overlap)) {
      best = { set, overlap };
    }
  }
  return best?.set ?? null;
}

/** The prepared answer Jev placed closest to a point on the plane. */
export function nearest(set: DemoSet, to: { x: number; y: number }) {
  return set.answers.reduce((best, answer) =>
    Math.hypot(answer.jev.x - to.x, answer.jev.y - to.y) <
    Math.hypot(best.jev.x - to.x, best.jev.y - to.y)
      ? answer
      : best,
  );
}

/** Where the model would land unprompted: the answer nearest the middle. */
export function opening(set: DemoSet) {
  return nearest(set, { x: 0.5, y: 0.5 });
}
