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
 *   JEV_API_KEY=... node scripts/precompute.mjs --score-only   # keep texts, re-score
 */

import { readFile, writeFile } from "node:fs/promises";
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
const JEV_MODEL = process.env.JEV_MODEL ?? "jev-latest";
const SCORE_ONLY = process.argv.includes("--score-only");

// Ordered rubrics: Jev returns a fractional index into these, which we
// normalise back to 0-1 for the grid.
const RUBRICS = {
  x: [
    "purely individual: only the asker's own life, choices, and feelings",
    "mostly individual, with passing reference to others",
    "mostly collective: other people's stake is central",
    "purely collective: family, community, society, or everyone who is implicated",
  ],
  y: [
    "purely material: money, runway, numbers, market, risk",
    "mostly material, with some appeal to meaning",
    "mostly spiritual: meaning, identity, calling",
    "purely spiritual: the soul, dharma, who you are becoming",
  ],
};

function detectProvider() {
  if (process.env.LLM_PROVIDER) return process.env.LLM_PROVIDER;
  const key = process.env.LLM_API_KEY ?? "";
  if (key.startsWith("sk-ant")) return "anthropic";
  if (key.startsWith("AIza")) return "gemini";
  if (key.startsWith("gsk_")) return "groq";
  return "openai";
}

const provider = detectProvider();

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

// OpenAI-compatible chat completions; Groq speaks the same protocol.
async function callOpenAI(prompt, { url, model, label }) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    throw new Error(`${label} ${response.status}: ${await response.text()}`);
  }
  const body = await response.json();
  return JSON.parse(body.choices[0].message.content);
}

async function callGemini(prompt) {
  const model = process.env.LLM_MODEL ?? "gemini-2.0-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": process.env.LLM_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Gemini ${response.status}: ${await response.text()}`);
  }
  const body = await response.json();
  return JSON.parse(body.candidates[0].content.parts[0].text);
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
  const providers = {
    anthropic: () => callAnthropic(prompt),
    gemini: () => callGemini(prompt),
    groq: () =>
      callOpenAI(prompt, {
        url: "https://api.groq.com/openai/v1/chat/completions",
        model: process.env.LLM_MODEL ?? "llama-3.3-70b-versatile",
        label: "Groq",
      }),
    openai: () =>
      callOpenAI(prompt, {
        url: "https://api.openai.com/v1/chat/completions",
        model: process.env.LLM_MODEL ?? "gpt-4o",
        label: "OpenAI",
      }),
  };
  const call = providers[provider];
  if (!call) throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
  const result = await call();
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
      questions: {
        x: {
          type: "score",
          instructions: `Does this answer frame the decision as one person's own life ("${AXES.x.min}") or as something embedded in other people ("${AXES.x.max}")?`,
          criteria: RUBRICS.x,
        },
        y: {
          type: "score",
          instructions: `Is this answer grounded in "${AXES.y.min}" concerns or "${AXES.y.max}" ones?`,
          criteria: RUBRICS.y,
        },
        hedging: {
          type: "noul",
          instructions:
            "Does this answer hedge - refuse to commit to a position, or present both sides as equally valid?",
        },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Jev ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

const round = (value) => Math.round(value * 100) / 100;

function readJev(payload) {
  const { answers } = payload;
  const axis = (id) => round(answers[id].score / (RUBRICS[id].length - 1));
  return {
    x: axis("x"),
    y: axis("y"),
    // noul is P(hedging), calibrated 0-1.
    hedging: answers.hedging.noul > 0.5,
    // How sure Jev is about where the answer sits. This is what the UI fades.
    confidence: round(Math.min(answers.x.confidence, answers.y.confidence)),
    model: payload.model ?? JEV_MODEL,
  };
}

async function existingAnswers() {
  const current = JSON.parse(await readFile(OUT, "utf8"));
  return current.cells.map((cell) => ({ voice: cell.voice, text: cell.text }));
}

async function main() {
  if (!process.env.JEV_API_KEY) throw new Error("JEV_API_KEY is not set");
  if (!SCORE_ONLY && !process.env.LLM_API_KEY) {
    throw new Error("LLM_API_KEY is not set (or pass --score-only)");
  }

  const cells = positions();
  const answers = SCORE_ONLY
    ? await existingAnswers()
    : await writeAnswers(cells);
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
