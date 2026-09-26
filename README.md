# Perspective Machine

Ask one question. Jev says where the answer stands. Drag the puck somewhere
else on the plane and the model is nudged until it genuinely stands there.

The plane has two modes:

- **Political compass** — the axes everyone already knows: economic left ←→
  right across, libertarian ←→ authoritarian up.
- **Create your own** — the model first works out which schools of thought
  disagree about your question, reaches for an established framework if one
  fits it (Baumrind on parenting, attachment theory on relationships,
  deontology ←→ consequentialism on ethics), and only invents axes when
  nothing established does. The plane relabels itself per question.

Either way the model writes a four-rung rubric for each axis in plain English,
and that rubric — not the axis name — is what Jev judges against. Jev does not
know what "virtue ethics" implies unless it is spelled out for it.

Chat on the left, plane on the right. Monochrome, light and dark.

## The loop

1. The model writes one answer.
2. Jev scores where that answer actually sits on both axes, plus a hedging
   check. Jev returns typed decisions with calibrated probabilities — it never
   writes text.
3. You drag the puck. The gap between Jev's score and the puck is handed back
   to the model as a nudge — "clearly more authoritarian, slightly more left" —
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
OpenAI, Anthropic, Gemini, Groq, and OpenRouter are supported; override with
`LLM_PROVIDER` / `LLM_MODEL`. Both keys stay on the server; the loop runs in
`POST /api/steer` (`src/lib/pipeline.ts`) and streams each attempt back.

Nothing is precomputed: the chat starts empty and the plane fills in once you
ask. `jev-latest` moves between versions, so the header shows the version Jev
reports for the answer on screen.
