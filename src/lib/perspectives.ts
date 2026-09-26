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

export type Perspectives = {
  question: string;
  axes: {
    x: { min: string; max: string };
    y: { min: string; max: string };
  };
  model: string;
  generatedAt: string | null;
  cells: Cell[];
};

export const perspectives = data as Perspectives;

export const GRID = 4;

export function cellAt(col: number, row: number): Cell {
  const cell = perspectives.cells.find((c) => c.col === col && c.row === row);
  if (!cell) throw new Error(`No cell at ${col},${row}`);
  return cell;
}

export function nearestCell(x: number, y: number): Cell {
  const col = Math.min(GRID - 1, Math.max(0, Math.floor(x * GRID)));
  const row = Math.min(GRID - 1, Math.max(0, Math.floor(y * GRID)));
  return cellAt(col, row);
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
