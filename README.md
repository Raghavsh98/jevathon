# Perspective Machine

One question. A 4×4 grid. Drag the puck and a different worldview answers.

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
npm run dev
```

Arrow keys move the puck one cell at a time.

## Regenerate the answers

Optional — the committed JSON is what the demo runs on.

```bash
LLM_API_KEY=... JEV_API_KEY=... npm run precompute
```

Set `LLM_PROVIDER=anthropic` for Claude, `QUESTION="..."` for a different
question. The script logs the `model` field Jev returns, since `jev-latest`
moves between versions.
