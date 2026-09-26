import { NextResponse } from "next/server";
import { buildPerspectives } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const { question } = (await request.json()) as { question?: string };
  const trimmed = question?.trim();
  if (!trimmed) {
    return NextResponse.json({ error: "Ask something first." }, { status: 400 });
  }

  try {
    return NextResponse.json(await buildPerspectives(trimmed.slice(0, 300)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("ask failed:", message);
    return NextResponse.json(
      { error: message.split("\n")[0].slice(0, 160) },
      { status: 502 },
    );
  }
}
