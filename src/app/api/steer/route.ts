import {
  MAX_NUDGES,
  RADIUS,
  assertKeys,
  distance,
  firstAnswer,
  nudge,
  score,
  type Answer,
  type Point,
} from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

type Body = {
  question?: string;
  answer?: Answer;
  at?: Point;
  target?: Point;
};

/**
 * Streams the loop as newline-delimited JSON so the UI can show each nudge as
 * it happens: write -> Jev scores -> too far -> nudge again.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  const question = body.question?.trim().slice(0, 300);
  if (!question) {
    return Response.json({ error: "Ask something first." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      try {
        assertKeys();

        let answer = body.answer;
        let at = body.at;

        if (!answer || !at) {
          answer = await firstAnswer(question);
          const jev = await score(question, answer);
          at = { x: jev.x, y: jev.y };
          send({ type: "answer", attempt: 0, answer, jev });
        }

        const target = body.target;
        if (target) {
          let best = { answer, at, gap: distance(at, target) };

          for (let attempt = 1; attempt <= MAX_NUDGES; attempt += 1) {
            send({ type: "nudging", attempt });
            const rewritten = await nudge({
              question,
              answer: best.answer,
              from: best.at,
              to: target,
            });
            const jev = await score(question, rewritten);
            const landed = { x: jev.x, y: jev.y };
            const gap = distance(landed, target);
            const hit = gap <= RADIUS;

            send({
              type: "answer",
              attempt,
              answer: rewritten,
              jev,
              gap: Math.round(gap * 100) / 100,
              hit,
            });

            // Keep whichever attempt got closest; a nudge can overshoot.
            if (gap < best.gap) best = { answer: rewritten, at: landed, gap };
            if (hit) break;
          }

          send({
            type: "done",
            hit: best.gap <= RADIUS,
            gap: Math.round(best.gap * 100) / 100,
          });
        } else {
          send({ type: "done", hit: true, gap: 0 });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("steer failed:", message);
        send({ type: "error", error: message.split("\n")[0].slice(0, 160) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
