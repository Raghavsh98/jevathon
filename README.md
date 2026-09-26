# Perspective Machine

Ask one question. Jev says where the answer stands. Drag the puck somewhere
else on the plane and the model is nudged until it genuinely stands there.

The plane has two axes:

- **x:** individual ←→ collective
- **y:** material ←→ spiritual

Chat on the left, plane on the right. Monochrome, light and dark.

## The loop

1. The model writes one answer.
2. Jev scores where that answer actually sits on both axes, plus a hedging
   check. Jev returns typed decisions with calibrated probabilities — it never
   writes text.
3. You drag the puck. The gap between Jev's score and the puck is handed back
   to the model as a nudge — "clearly more collective, slightly more material" —
   and it rewrites.
4. Jev re-scores. Still outside the puck's radius, it gets nudged again, up to
   six times. Whichever attempt lands closest is kept.

Every attempt shows up in the chat, so the loop is the interface: you watch the
model overshoot, get corrected, and settle. Jev decides when it has arrived —
not the model, and not a prompt claiming it moved.

The dot on the plane is Jev's score for the current answer, faded and blurred
by how confident Jev is. The ring is your puck, and the dashed line is the gap
still to close.

## Run it

```bash
npm install
cp .env.example .env.local   # add your keys
npm run dev
```

`JEV_API_KEY` is required. The LLM provider is detected from the key shape —
OpenAI, Anthropic, Gemini, and Groq are supported; override with
`LLM_PROVIDER` / `LLM_MODEL`. Both keys stay on the server; the loop runs in
`POST /api/steer` (`src/lib/pipeline.ts`) and streams each attempt back.

## The seed answer

`src/data/responses.json` holds a set of answers already scored by Jev. One of
them is on screen at load, so the plane is never empty and the demo opens with
no network call. Regenerate it with:

```bash
LLM_API_KEY=... JEV_API_KEY=... npm run precompute
JEV_API_KEY=... npm run precompute -- --score-only   # keep texts, re-score
```

`jev-latest` moves between versions, so the script logs the `model` Jev
returns. The committed data was scored by `jev-1.13.0`.
