import data from "@/data/responses.json";

export type JevScore = {
  x: number;
  y: number;
  hedging: boolean;
  confidence: number;
};

export type Cell = {
  id: string;
  col: number;
  row: number;
  x: number;
  y: number;
  voice: string;
  text: string;
  jev: JevScore;
};

export type Axes = {
  x: { min: string; max: string };
  y: { min: string; max: string };
};

export type Perspectives = {
  question: string;
  axes: Axes;
  model: string;
  generatedAt: string | null;
  cells: Cell[];
};

export const AXES: Axes = {
  x: { min: "individual", max: "collective" },
  y: { min: "material", max: "spiritual" },
};

export const GRID = 4;

/** The demo set, precomputed and committed so the grid works with no network. */
export const precomputed = data as Perspectives;

export function cellAt(cells: Cell[], col: number, row: number): Cell {
  const cell = cells.find((c) => c.col === col && c.row === row);
  if (!cell) throw new Error(`No cell at ${col},${row}`);
  return cell;
}

export function nearestCell(cells: Cell[], x: number, y: number): Cell {
  const col = Math.min(GRID - 1, Math.max(0, Math.floor(x * GRID)));
  const row = Math.min(GRID - 1, Math.max(0, Math.floor(y * GRID)));
  return cellAt(cells, col, row);
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
