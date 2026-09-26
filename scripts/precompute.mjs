/**
 * Regenerates src/data/responses.json.
 *
 *   1. one LLM call  -> 16 responses, one per grid cell, each prompted with its axis position
 *   2. one Jev batch -> each response scored on both axes + a hedging check
 *   3. write the file; the app reads it statically and never calls a network at runtime
 *
 * Usage:
 *   LLM_API_KEY=... JEV_API_KEY=... node scripts/precompute.mjs
 *   LLM_PROVIDER=anthropic node scripts/precompute.mjs
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const OUT = path.join(process.cwd(), "src", "data", "responses.json");
const GRID = 4;

const QUESTION =
  process.env.QUESTION ?? "Should I quit my job to build my own thing?";
const AXES = {
  x: { min: "individual", max: "collective" },
  y: { min: "material", max: "spiritual" },
};

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";

const provider =
  process.env.LLM_PROVIDER ??
  (process.env.LLM_API_KEY?.startsWith("sk-ant") ? "anthropic" : "openai");

function positions() {
  const cells = [];
  for (let row = 0; row < GRID; row += 1) {
    for (let col = 0; col < GRID; col += 1) {
      cells.push({
        id: `c-${col}-${row}`,
        col,
        row,
        x: (col + 0.5) / GRID,
        y: 1 - (row + 0.5) / GRID,
      });
    }
  }
  return cells;
}

function describe(cell) {
  const x = Math.round(cell.x * 100);
  const y = Math.round(cell.y * 100);
  return `${x}% toward "${AXES.x.max}" (0% = "${AXES.x.min}"), ${y}% toward "${AXES.y.max}" (0% = "${AXES.y.min}")`;
}

function buildPrompt(cells) {
  return [
    `Question: "${QUESTION}"`,
    "",
    "Write 16 different answers. Each one comes from a different worldview, fixed by its position on two axes:",
    `  x: ${AXES.x.min} <-> ${AXES.x.max}`,
    `  y: ${AXES.y.min} <-> ${AXES.y.max}`,
    "",
    "Positions:",
    ...cells.map((cell, index) => `  ${index + 1}. ${describe(cell)}`),
    "",
    "Rules:",
    "- Each answer takes a real position. No hedging, no 'it depends', no listing both sides.",
    "- 2-4 sentences. Direct address to the asker. No preamble, no headings, no markdown.",
    "- Answers must disagree with each other. Someone reading two of them should feel the tension.",
    "- Give each one a short label (2-4 words) naming the voice speaking, not the axis position.",
    "",
    'Return strict JSON: {"answers":[{"voice":"...","text":"..."}]} with exactly 16 items in the order listed.',
  ].join("\n");
}

async function callOpenAI(prompt) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL ?? "gpt-4o",
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
  }
  const body = await response.json();
  return JSON.parse(body.choices[0].message.content);
}

async function callAnthropic(prompt) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.LLM_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL ?? "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        { role: "user", content: prompt },
        { role: "assistant", content: "{" },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Anthropic ${response.status}: ${await response.text()}`);
  }
  const body = await response.json();
  return JSON.parse(`{${body.content[0].text}`);
}

async function writeAnswers(cells) {
  const prompt = buildPrompt(cells);
  const result =
    provider === "anthropic"
      ? await callAnthropic(prompt)
      : await callOpenAI(prompt);
  const answers = result.answers ?? result.responses;
  if (!Array.isArray(answers) || answers.length !== 16) {
    throw new Error(`Expected 16 answers, got ${answers?.length}`);
  }
  return answers;
}

async function scoreWithJev(answer) {
  const response = await fetch(JEV_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.JEV_API_KEY}`,
    },
    body: JSON.stringify({
      model: JEV_MODEL,
      state: {
        question: QUESTION,
        answer: answer.text,
        voice: answer.voice,
        axes: AXES,
      },
      questions: [
        {
          id: "x",
          type: "score",
          question: `On a 0-1 scale, how far does this answer sit toward "${AXES.x.max}" rather than "${AXES.x.min}"?`,
        },
        {
          id: "y",
          type: "score",
          question: `On a 0-1 scale, how far does this answer sit toward "${AXES.y.max}" rather than "${AXES.y.min}"?`,
        },
        {
          id: "hedging",
          type: "yes_no",
          question:
            "Does this answer hedge — refuse to commit to a position, or present both sides as equally valid?",
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Jev ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function readJev(payload) {
  const answers = payload.answers ?? payload.results ?? payload.questions ?? [];
  const byId = Object.fromEntries(
    answers.map((item) => [item.id ?? item.question_id, item]),
  );
  const value = (id, fallback) => {
    const item = byId[id];
    if (!item) return fallback;
    const raw = item.answer ?? item.value ?? item.score ?? item.result;
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "string") return raw.toLowerCase() === "yes";
    return typeof raw === "number" ? raw : fallback;
  };
  const confidence = (id, fallback) => {
    const item = byId[id];
    const raw = item?.confidence ?? item?.probability;
    return typeof raw === "number" ? raw : fallback;
  };
  return {
    x: value("x", 0.5),
    y: value("y", 0.5),
    hedging: Boolean(value("hedging", false)),
    confidence: Math.min(
      confidence("x", 0.7),
      confidence("y", 0.7),
      confidence("hedging", 0.7),
    ),
    model: payload.model ?? JEV_MODEL,
  };
}

async function main() {
  if (!process.env.LLM_API_KEY) throw new Error("LLM_API_KEY is not set");
  if (!process.env.JEV_API_KEY) throw new Error("JEV_API_KEY is not set");

  const cells = positions();
  const answers = await writeAnswers(cells);
  const scores = await Promise.all(
    answers.map((answer) => scoreWithJev(answer).then(readJev)),
  );

  console.log("jev model:", scores[0].model);

  const payload = {
    question: QUESTION,
    axes: AXES,
    model: scores[0].model,
    generatedAt: new Date().toISOString(),
    cells: cells.map((cell, index) => ({
      ...cell,
      voice: answers[index].voice,
      text: answers[index].text,
      jev: {
        x: scores[index].x,
        y: scores[index].y,
        hedging: scores[index].hedging,
        confidence: scores[index].confidence,
      },
    })),
  };

  await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`wrote ${OUT}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
