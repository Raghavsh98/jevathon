# Perspective Machine

One question. A 4×4 grid. Drag the puck and a different worldview answers.

Chat on the left, grid on the right. Monochrome, light and dark.

Moving the puck does not rephrase the answer — it changes who is speaking. The
axes are hardcoded:

- **x:** individual ←→ collective
- **y:** material ←→ spiritual

## How it works

Nothing is generated while you drag.

1. An LLM writes 16 answers, one per cell, each prompted with its axis position.
2. Jev scores each answer: where it actually sits on both axes, and whether it
   is hedging. Jev returns typed decisions with calibrated probabilities — it
   does not write text.
3. The 16 scored answers are committed to `src/data/responses.json`.
4. Dragging is a lookup and a crossfade. No network, no latency, cannot fail.

Jev's confidence is rendered as a visual material: low confidence cells are
faded and blurred, high confidence cells are sharp. Hedging answers carry a dot.

## Run it

```bash
npm install
cp .env.example .env.local   # add your keys
npm run dev
```

Arrow keys move the puck one cell at a time.

## Asking your own question

The committed set answers the demo question with zero latency. Typing a new
question in the chat runs the same two steps live through `POST /api/ask`
(`src/lib/pipeline.ts`) and takes about half a minute — the keys stay on the
server. If that call fails, the grid keeps whatever it was showing.

## Regenerate the answers

Optional — the committed JSON is what the demo runs on.

```bash
# rewrite all 16 answers, then score them
LLM_API_KEY=... JEV_API_KEY=... npm run precompute

# keep the answers, just re-score them with Jev
JEV_API_KEY=... npm run precompute -- --score-only
```

Same two steps as `/api/ask`, written to disk instead of served.
The provider is detected from the key shape — OpenAI, Anthropic, Gemini, and
Groq are supported; override with `LLM_PROVIDER` / `LLM_MODEL`. Set
`QUESTION="..."` for a different question.

The script logs the `model` field Jev returns, since `jev-latest` moves between
versions. The committed data was scored by `jev-1.13.0`.
