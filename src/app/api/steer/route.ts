import {
  MAX_NUDGES,
  RADIUS,
  answerIn,
  assertKeys,
  distance,
  nudge,
  open,
  score,
  type Answer,
  type Point,
} from "@/lib/pipeline";
import type { Frame } from "@/lib/perspectives";

export const runtime = "nodejs";
export const maxDuration = 300;

type Body = {
  question?: string;
  frame?: Frame;
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
      // Writing to a stream the client already walked away from throws; that
      // is a stop, not a failure.
      const send = (event: object) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {}
      };

      try {
        assertKeys();

        let answer = body.answer;
        let at = body.at;
        let frame = body.frame;

        if (!answer || !at) {
          // A frame with no answer yet means the user picked the plane
          // themselves; otherwise the model draws it.
          if (frame) {
            answer = await answerIn(question, frame);
          } else {
            const opened = await open(question);
            frame = opened.frame;
            answer = opened.answer;
            send({ type: "frame", frame });
          }
          const jev = await score(question, frame, answer);
          at = { x: jev.x, y: jev.y };
          send({ type: "answer", attempt: 0, answer, jev });
        }

        const target = body.target;
        if (target && frame) {
          let best = { answer, at, gap: distance(at, target) };

          for (let attempt = 1; attempt <= MAX_NUDGES; attempt += 1) {
            // The user pressed stop: keep whatever they already have.
            if (request.signal.aborted) break;
            send({ type: "nudging", attempt });
            const rewritten = await nudge({
              question,
              frame,
              answer: best.answer,
              from: best.at,
              to: target,
            });
            const jev = await score(question, frame, rewritten);
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
            if (hit || request.signal.aborted) break;
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
