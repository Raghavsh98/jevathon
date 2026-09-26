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

import { RADIUS, type Frame, type JevScore } from "./perspectives";

export { RADIUS };

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = process.env.JEV_MODEL ?? "jev-latest";

/** Nudges per drag before we stop and keep the closest attempt. */
export const MAX_NUDGES = 6;

export type Answer = { voice: string; text: string };
export type Point = { x: number; y: number };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Free LLM tiers return 429/503 under load; back off rather than drop a nudge.
async function withRetries<T>(attempt: () => Promise<T>): Promise<T> {
  const delays = [1500, 4000, 9000, 15000, 20000];
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
  if (key.startsWith("sk-or-")) return "openrouter";
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
  const model = process.env.LLM_MODEL ?? "gemini-3.8-flash";
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

type Json = Record<string, unknown>;

async function callLLM(prompt: string): Promise<Json> {
  const provider = detectProvider();
  const providers: Record<string, () => Promise<Json>> = {
    anthropic: () => callAnthropic(prompt),
    gemini: () => callGemini(prompt),
    groq: () =>
      callOpenAI(prompt, {
        url: "https://api.groq.com/openai/v1/chat/completions",
        model: process.env.LLM_MODEL ?? "llama-3.3-70b-versatile",
        label: "Groq",
      }),
    openrouter: () =>
      callOpenAI(prompt, {
        url: "https://openrouter.ai/api/v1/chat/completions",
        model:
          process.env.LLM_MODEL ?? "nvidia/nemotron-3-super-120b-a12b:free",
        label: "OpenRouter",
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
  return withRetries(call);
}

function readAnswer(result: Json): Answer {
  const text = typeof result.text === "string" ? result.text.trim() : "";
  if (!text) throw new Error("The model returned no answer");
  const voice = typeof result.voice === "string" ? result.voice : "";
  return { voice: voice || "A view", text };
}

function readAxis(value: unknown, fallbackName: string) {
  const axis = (value ?? {}) as Json;
  const rubric = Array.isArray(axis.rubric)
    ? axis.rubric.filter((rung): rung is string => typeof rung === "string")
    : [];
  if (rubric.length < 2) {
    throw new Error(`The model gave no rubric for the ${fallbackName} axis`);
  }
  const end = (key: "min" | "max", index: number) =>
    typeof axis[key] === "string" && axis[key].trim()
      ? (axis[key] as string).trim()
      : rubric[index].split(":")[0];
  return { min: end("min", 0), max: end("max", rubric.length - 1), rubric };
}

function readFrame(result: Json): Frame {
  const axes = (result.axes ?? {}) as Json;
  const schools = Array.isArray(result.schools)
    ? result.schools.filter((s): s is string => typeof s === "string")
    : [];
  const framework =
    typeof result.framework === "string" ? result.framework.trim() : "";
  return {
    x: readAxis(axes.x, "horizontal"),
    y: readAxis(axes.y, "vertical"),
    schools,
    framework,
  };
}

const SHAPE =
  'Return strict JSON: {"voice":"2-4 words naming who is speaking","text":"the answer"}.';
const STYLE = [
  "- Take a real position. No hedging, no 'it depends', no both-sides.",
  "- 2-4 sentences, speaking directly to the asker. No preamble, no markdown.",
];

/**
 * The first call of a chat does two jobs: it works out what people actually
 * disagree about in this question, turns that into the two axes of the plane,
 * and answers from wherever it naturally stands.
 */
export async function open(
  question: string,
): Promise<{ frame: Frame; answer: Answer }> {
  const result = await callLLM(
    [
      `Question: "${question}"`,
      "",
      "First think about the schools of thought people answer this from - the",
      "real, named traditions or camps that would disagree here.",
      "",
      "Then pick the two axes this answer should be plotted on. If a framework",
      "a well-read person already knows covers this question's territory, you",
      "must use it, with its real name and its real axis names - do not invent",
      "a private vocabulary for a disagreement the world has already mapped.",
      "Examples of what counts as established:",
      "  politics: the Political Compass (economic left <-> right, libertarian",
      "    <-> authoritarian)",
      "  parenting: Baumrind's styles (responsiveness, demandingness)",
      "  relationships: attachment theory (attachment anxiety, avoidance)",
      "  ethics: deontology <-> consequentialism, and Haidt's moral foundations",
      "  culture and work: Hofstede's dimensions",
      "  economics: state intervention <-> free market, and similar textbook",
      "    splits",
      "Those are illustrations, not a menu - any framework a well-read person",
      "would already know is fine. Only invent axes when nothing established",
      "fits, and then derive them from the disagreement you just named.",
      "",
      "Rules for the two axes either way:",
      "- They must actually discriminate between answers to THIS question.",
      "- They must be independent: an answer can be anywhere on one regardless",
      "  of where it sits on the other. If your two axes measure the same",
      "  disagreement twice, replace one.",
      "- Each end is 1-3 words, lowercase.",
      "- Each axis needs a rubric: exactly 4 rungs, in order from the min end to",
      "  the max end, each one a short plain-English description of an answer at",
      "  that point. Write them so a judge who has never seen this question",
      "  could place an answer without guessing.",
      "",
      "Then answer the question from whatever standpoint you would naturally",
      "take.",
      ...STYLE,
      "",
      "Return strict JSON:",
      '{"framework":"name of the established framework, or \'\' if you invented the axes",',
      ' "schools":["named school of thought", ...],',
      ' "axes":{"x":{"min":"","max":"","rubric":["","","",""]},',
      '         "y":{"min":"","max":"","rubric":["","","",""]}},',
      ' "voice":"2-4 words naming who is speaking","text":"the answer"}',
    ].join("\n"),
  );
  return { frame: readFrame(result), answer: readAnswer(result) };
}

/**
 * Same first turn, but on a plane the user already chose (the Political
 * Compass). The axes are fixed, so the model only has to answer.
 */
export async function answerIn(
  question: string,
  frame: Frame,
): Promise<Answer> {
  const result = await callLLM(
    [
      `Question: "${question}"`,
      "",
      `Answers to this are plotted on ${frame.framework || "a fixed plane"}:`,
      `  x: ${frame.x.min} <-> ${frame.x.max}`,
      `  y: ${frame.y.min} <-> ${frame.y.max}`,
      "",
      "Answer the question from whatever standpoint you would naturally take.",
      "Do not mention the plane or where you sit on it.",
      ...STYLE,
      "",
      SHAPE,
    ].join("\n"),
  );
  return readAnswer(result);
}

/** Plain-language version of the drag, so the model is steered, not coordinated. */
function describeDelta(from: Point, to: Point, axes: Frame) {
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
  frame,
  answer,
  from,
  to,
}: {
  question: string;
  frame: Frame;
  answer: Answer;
  from: Point;
  to: Point;
}): Promise<Answer> {
  const [moveX, moveY] = describeDelta(from, to, frame);
  const result = await callLLM(
    [
      `Question: "${question}"`,
      "",
      "Current answer:",
      answer.text,
      "",
      "Two axes describe where an answer stands:",
      `  x: ${frame.x.min} (0.00) <-> ${frame.x.max} (1.00)`,
      ...frame.x.rubric.map((rung, i) => `     ${i}. ${rung}`),
      `  y: ${frame.y.min} (0.00) <-> ${frame.y.max} (1.00)`,
      ...frame.y.rubric.map((rung, i) => `     ${i}. ${rung}`),
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
  return readAnswer(result);
}

type JevAnswer = { score: number; confidence: number; noul: number };

const round = (value: number) => Math.round(value * 100) / 100;

export async function score(
  question: string,
  frame: Frame,
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
          schools: frame.schools,
        },
        questions: {
          x: {
            type: "score",
            instructions: `Where does this answer sit between "${frame.x.min}" and "${frame.x.max}"?`,
            criteria: frame.x.rubric,
          },
          y: {
            type: "score",
            instructions: `Where does this answer sit between "${frame.y.min}" and "${frame.y.max}"?`,
            criteria: frame.y.rubric,
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
    round(answers[id].score / (frame[id].rubric.length - 1));
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
