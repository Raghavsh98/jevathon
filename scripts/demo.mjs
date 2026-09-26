/**
 * Regenerates src/data/demo.json - the answers that sit behind the plane on
 * this branch so a demo never waits on, or is embarrassed by, a live model.
 *
 * For each prepared question it asks the model for 16 answers, one per cell of
 * a 4x4 sweep of the plane, then has Jev score every one of them for real.
 * Where Jev lands nothing near a cell, it runs the real nudge loop offline
 * until something sits there. At runtime the app serves the nearest scored
 * answer instead of calling out, so the plane is covered wherever you drag.
 *
 *   LLM_API_KEY=... JEV_API_KEY=... node scripts/demo.mjs
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const OUT = path.join(process.cwd(), "src", "data", "demo.json");
const GRID = 4;
/** How close a prepared answer must sit to a cell before that cell is done. */
const COVERED = 0.12;
const FILL_ATTEMPTS = 3;

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = process.env.JEV_MODEL ?? "jev-latest";

const COMPASS = {
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

const BAUMRIND = {
  framework: "Baumrind's parenting styles",
  schools: ["authoritative", "authoritarian", "permissive", "neglectful"],
  x: {
    min: "undemanding",
    max: "demanding",
    rubric: [
      "Undemanding: sets no rules or expectations; the teenager decides everything.",
      "Lightly demanding: a few loose expectations, rarely enforced.",
      "Firmly demanding: clear rules with real consequences, applied consistently.",
      "Highly demanding: strict, non-negotiable rules; obedience is the point.",
    ],
  },
  y: {
    min: "unresponsive",
    max: "responsive",
    rubric: [
      "Unresponsive: the teenager's feelings and view of it do not enter the answer.",
      "Slightly responsive: acknowledges their feelings, but the parent's convenience decides.",
      "Warm: takes the teenager's need for independence seriously and explains the reasoning.",
      "Highly responsive: decides with the teenager, negotiating the rule together.",
    ],
  },
};

const SETS = [
  {
    id: "taxes",
    mode: "compass",
    question: "Should the government raise taxes on the rich?",
    frame: COMPASS,
  },
  {
    id: "curfew",
    mode: "auto",
    question: "Should I let my teenager stay out past midnight?",
    frame: BAUMRIND,
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetries(label, attempt) {
  const delays = [2000, 5000, 12000, 25000];
  for (let i = 0; ; i += 1) {
    try {
      return await attempt();
    } catch (error) {
      const retryable = /\b(429|500|502|503|504)\b/.test(error.message);
      if (!retryable || i >= delays.length) throw error;
      console.warn(`${label} busy, retrying in ${delays[i] / 1000}s`);
      await sleep(delays[i]);
    }
  }
}

function detectProvider() {
  if (process.env.LLM_PROVIDER) return process.env.LLM_PROVIDER;
  const key = process.env.LLM_API_KEY ?? "";
  if (key.startsWith("sk-or-")) return "openrouter";
  if (key.startsWith("sk-ant")) return "anthropic";
  if (key.startsWith("gsk_")) return "groq";
  if (key.startsWith("sk-")) return "openai";
  return "gemini";
}

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
  const model = process.env.LLM_MODEL ?? "gemini-3.1-flash-lite";
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

function callLLM(prompt) {
  const provider = detectProvider();
  const providers = {
    gemini: () => callGemini(prompt),
    openrouter: () =>
      callOpenAI(prompt, {
        url: "https://openrouter.ai/api/v1/chat/completions",
        model:
          process.env.LLM_MODEL ?? "nvidia/nemotron-3-super-120b-a12b:free",
        label: "OpenRouter",
      }),
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
  const call = providers[detectProvider()];
  if (!call) throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
  return withRetries(provider, call);
}

function cells() {
  const out = [];
  for (let row = 0; row < GRID; row += 1) {
    for (let col = 0; col < GRID; col += 1) {
      out.push({ x: (col + 0.5) / GRID, y: 1 - (row + 0.5) / GRID });
    }
  }
  return out;
}

function rung(axis, value) {
  const index = Math.min(
    axis.rubric.length - 1,
    Math.round(value * (axis.rubric.length - 1)),
  );
  return axis.rubric[index];
}

function prompt(set, positions) {
  return [
    `Question: "${set.question}"`,
    "",
    `Answers are plotted on ${set.frame.framework}:`,
    `  x: ${set.frame.x.min} <-> ${set.frame.x.max}`,
    `  y: ${set.frame.y.min} <-> ${set.frame.y.max}`,
    "",
    "Write 16 answers, one from each of these standpoints:",
    ...positions.map(
      (point, index) =>
        `  ${index + 1}. ${rung(set.frame.x, point.x)} / ${rung(set.frame.y, point.y)}`,
    ),
    "",
    "Rules:",
    "- Each answer holds its position outright. No hedging, no 'it depends',",
    "  no presenting both sides.",
    "- 2-4 sentences, speaking directly to the asker. No preamble, no",
    "  markdown, no headings.",
    "- Never name the framework, the axes, or where the answer sits.",
    "- Neighbouring answers must still disagree with each other.",
    "- Give each a 2-4 word label naming who is speaking, not its position.",
    "",
    'Return strict JSON: {"answers":[{"voice":"...","text":"..."}]} with',
    "exactly 16 items, in the order listed.",
  ].join("\n");
}

async function scoreWithJev(set, answer) {
  const response = await fetch(JEV_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.JEV_API_KEY}`,
    },
    body: JSON.stringify({
      model: JEV_MODEL,
      state: {
        question: set.question,
        answer: answer.text,
        voice: answer.voice,
        schools: set.frame.schools,
      },
      questions: {
        x: {
          type: "score",
          instructions: `Where does this answer sit between "${set.frame.x.min}" and "${set.frame.x.max}"?`,
          criteria: set.frame.x.rubric,
        },
        y: {
          type: "score",
          instructions: `Where does this answer sit between "${set.frame.y.min}" and "${set.frame.y.max}"?`,
          criteria: set.frame.y.rubric,
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

function readJev(set, payload) {
  const { answers } = payload;
  const axis = (id) =>
    round(answers[id].score / (set.frame[id].rubric.length - 1));
  return {
    x: axis("x"),
    y: axis("y"),
    hedging: answers.hedging.noul > 0.5,
    confidence: round(Math.min(answers.x.confidence, answers.y.confidence)),
    model: payload.model ?? JEV_MODEL,
  };
}

/** The same nudge the live loop sends, so prepared answers are made the same way. */
function nudgePrompt(set, answer, from, to) {
  const move = (axis, delta) => {
    const size = Math.abs(delta) < 0.12 ? "slightly" : "clearly";
    const end = delta > 0 ? axis.max : axis.min;
    return Math.abs(delta) < 0.04 ? null : `${size} more ${end}`;
  };
  const moves = [
    move(set.frame.x, to.x - from.x),
    move(set.frame.y, to.y - from.y),
  ].filter(Boolean);
  return [
    `Question: "${set.question}"`,
    "",
    "Current answer:",
    answer.text,
    "",
    `Rewrite it to be ${moves.join(" and ")}.`,
    "",
    "Rules:",
    "- Hold the new position outright. No hedging, no 'it depends'.",
    "- 2-4 sentences, speaking directly to the asker. No preamble.",
    "- Never name the framework, the axes, or that the answer moved.",
    "- Give a 2-4 word label naming who is speaking.",
    "",
    'Return strict JSON: {"voice":"...","text":"..."}',
  ].join("\n");
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const nearest = (pool, to) =>
  pool.reduce((best, item) =>
    distance(item.jev, to) < distance(best.jev, to) ? item : best,
  );

async function place(set, answer) {
  const payload = await withRetries("jev", () => scoreWithJev(set, answer));
  return { voice: answer.voice, text: answer.text, jev: readJev(set, payload) };
}

async function build(set) {
  const positions = cells();
  const result = await callLLM(prompt(set, positions));
  const written = result.answers ?? result.responses;
  if (!Array.isArray(written) || written.length !== GRID * GRID) {
    throw new Error(`${set.id}: expected 16 answers, got ${written?.length}`);
  }

  const pool = [];
  for (const answer of written) pool.push(await place(set, answer));
  console.log(`${set.id}: 16 answers scored by ${pool[0].jev.model}`);

  // Jev rarely lands them evenly, so nudge toward whichever cells came up bare.
  for (const cell of positions) {
    for (let attempt = 0; attempt < FILL_ATTEMPTS; attempt += 1) {
      const closest = nearest(pool, cell);
      const gap = distance(closest.jev, cell);
      if (gap <= COVERED) break;
      const rewritten = await callLLM(
        nudgePrompt(set, closest, closest.jev, cell),
      );
      const placed = await place(set, rewritten);
      pool.push(placed);
      console.log(
        `${set.id}: ${cell.x.toFixed(2)},${cell.y.toFixed(2)} ${gap.toFixed(2)} -> ${distance(placed.jev, cell).toFixed(2)}`,
      );
    }
  }

  console.log(`${set.id}: ${pool.length} answers in the set`);
  return {
    id: set.id,
    mode: set.mode,
    question: set.question,
    frame: set.frame,
    answers: pool,
  };
}

async function main() {
  if (!process.env.JEV_API_KEY) throw new Error("JEV_API_KEY is not set");
  if (!process.env.LLM_API_KEY) throw new Error("LLM_API_KEY is not set");

  const sets = [];
  for (const set of SETS) sets.push(await build(set));

  await writeFile(
    OUT,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), sets }, null, 2)}\n`,
  );
  console.log(`wrote ${OUT}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
