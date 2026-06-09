# CLAUDE.md — Tex voice surface (frontend)

This is the **voice/interface** layer for Tex (the agent-governance backend lives at `~/dev/tex`; read its
`CLAUDE.md`, `ROADMAP.md`, and `COORDINATION.md` for the full doctrine and the parallel-work rules).

## Doctrine (do not violate)
- **Backend decides, frontend renders.** The frontend computes nothing about what Tex says — it renders what the
  backend chose. No client-side risk logic.
- **Only an ABSTAIN ever surfaces as a held card.** PERMIT/FORBID are invisible. The operator's single act is sealing a hold.
- **Silence is the failure mode** — no spinners, no error toasts; keep the last good truth on screen.
- **The spoken voice is a grounded cascade, never end-to-end speech-to-speech**: STT → `/v1/ask` (answers ONLY from
  sealed facts) → TTS. Never put a free-running LLM in the speaking seat. Do NOT "upgrade" this to a native S2S model.

## Mandate: research-first, frontier-or-beyond
Before building non-trivial UI/voice work, survey the current frontier (grounded QA, faithfulness/NLI gating,
self-hostable streaming STT/TTS) as of today's date; pick the most advanced viable approach; tag maturity honestly;
test as you build. Never ship theater.

## Parallel work
This repo is owned by the **`voice`** track (see `~/dev/tex/COORDINATION.md`). If you're not that track, don't edit here.
