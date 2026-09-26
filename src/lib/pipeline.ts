/**
 * The steering loop, server side.
 *
 *   - the LLM writes one answer
 *   - Jev scores where that answer actually sits on the two axes
 *   - drag the puck and the LLM is nudged by the delta, Jev re-scores, repeat
 *     until the answer lands inside the puck's radius
 *
 * The LLM writes; Jev judges. Neither does the other's job.
 */

import { AXES, RADIUS, type Axes, type JevScore } from "./perspectives";

export { RADIUS };

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = process.env.JEV_MODEL ?? "jev-latest";

/** Nudges per drag before we stop and keep the closest attempt. */
export const MAX_NUDGES = 6;

// Ordered rubrics: Jev returns a fractional index into these, which we
// normalise back to 0-1 for the plane.
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

export type Answer = { voice: string; text: string };
export type Point = { x: number; y: number };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Free LLM tiers return 429/503 under load; back off rather than drop a nudge.
async function withRetries<T>(attempt: () => Promise<T>): Promise<T> {
  const delays = [1500, 4000, 9000];
  for (let i = 0; ; i += 1) {
    try {
      return await attempt();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = /\b(429|500|502|503|504)\b/.test(message);
      if (!retryable || i >= delays.length) throw error;
      await sleep(delays[i]);
    }
  }
}

function detectProvider() {
  if (process.env.LLM_PROVIDER) return process.env.LLM_PROVIDER;
  const key = process.env.LLM_API_KEY ?? "";
  if (key.startsWith("sk-ant")) return "anthropic";
  if (key.startsWith("gsk_")) return "groq";
  if (key.startsWith("sk-")) return "openai";
  return "gemini";
}

// OpenAI-compatible chat completions; Groq speaks the same protocol.
async function callOpenAI(
  prompt: string,
  { url, model, label }: { url: string; model: string; label: string },
) {
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

async function callGemini(prompt: string) {
  const model = process.env.LLM_MODEL ?? "gemini-3-flash-preview";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": process.env.LLM_API_KEY ?? "",
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

async function callAnthropic(prompt: string) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.LLM_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL ?? "claude-sonnet-4-20250514",
      max_tokens: 1024,
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

async function callLLM(prompt: string): Promise<Answer> {
  const provider = detectProvider();
  const providers: Record<string, () => Promise<Partial<Answer>>> = {
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
  const result = await withRetries(call);
  if (!result.text) throw new Error("The model returned no answer");
  return { voice: result.voice ?? "A view", text: result.text };
}

const SHAPE =
  'Return strict JSON: {"voice":"2-4 words naming who is speaking","text":"the answer"}.';
const STYLE = [
  "- Take a real position. No hedging, no 'it depends', no both-sides.",
  "- 2-4 sentences, speaking directly to the asker. No preamble, no markdown.",
];

export async function firstAnswer(question: string) {
  return callLLM(
    [
      `Question: "${question}"`,
      "",
      "Answer it from whatever standpoint you would naturally take.",
      ...STYLE,
      "",
      SHAPE,
    ].join("\n"),
  );
}

/** Plain-language version of the drag, so the model is steered, not coordinated. */
function describeDelta(from: Point, to: Point, axes: Axes) {
  const move = (delta: number, min: string, max: string) => {
    const size = Math.abs(delta);
    if (size < 0.06) return `hold this axis exactly where it is`;
    const amount =
      size > 0.45 ? "far more" : size > 0.2 ? "clearly more" : "slightly more";
    return `make it ${amount} ${delta > 0 ? max : min}`;
  };
  return [
    move(to.x - from.x, axes.x.min, axes.x.max),
    move(to.y - from.y, axes.y.min, axes.y.max),
  ];
}

export async function nudge({
  question,
  answer,
  from,
  to,
}: {
  question: string;
  answer: Answer;
  from: Point;
  to: Point;
}) {
  const [moveX, moveY] = describeDelta(from, to, AXES);
  return callLLM(
    [
      `Question: "${question}"`,
      "",
      "Current answer:",
      answer.text,
      "",
      "Two axes describe where an answer stands:",
      `  x: ${AXES.x.min} (0.00) <-> ${AXES.x.max} (1.00)`,
      `  y: ${AXES.y.min} (0.00) <-> ${AXES.y.max} (1.00)`,
      "",
      `An independent judge placed the current answer at x ${from.x.toFixed(2)}, y ${from.y.toFixed(2)}.`,
      `It needs to sit at x ${to.x.toFixed(2)}, y ${to.y.toFixed(2)}: ${moveX}, and ${moveY}.`,
      "",
      "Rewrite the answer so it genuinely stands there. Same question, same",
      "person being addressed. Do not describe the axes or mention the move -",
      "just answer from that standpoint. If an axis only needs a small move,",
      "change it only slightly: overshooting to the extreme is as wrong as not",
      "moving at all.",
      ...STYLE,
      "",
      SHAPE,
    ].join("\n"),
  );
}

type JevAnswer = { score: number; confidence: number; noul: number };

const round = (value: number) => Math.round(value * 100) / 100;

export async function score(
  question: string,
  answer: Answer,
): Promise<JevScore & { model: string }> {
  const request = async () => {
    const response = await fetch(JEV_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.JEV_API_KEY}`,
      },
      body: JSON.stringify({
        model: JEV_MODEL,
        state: {
          question,
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
    return response.json() as Promise<{
      model?: string;
      answers: Record<string, JevAnswer>;
    }>;
  };

  const payload = await withRetries(request);
  const answers = payload.answers;
  const axis = (id: "x" | "y") =>
    round(answers[id].score / (RUBRICS[id].length - 1));
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

export function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function assertKeys() {
  if (!process.env.JEV_API_KEY) throw new Error("JEV_API_KEY is not set");
  if (!process.env.LLM_API_KEY) throw new Error("LLM_API_KEY is not set");
}
