import { useState } from "react";
import SpokenLine from "./SpokenLine";
import "./SpanAnswer.css";

/**
 * SpanAnswer — render one AnswerResponse from the FLUID-TRUTH ANSWER PIPELINE.
 *
 * The backend answers a typed question as an ordered list of SPANS, each a
 * template whose number-slots were filled by deterministic exhibits (tool-
 * computed values, never model-authored digits). This surface RENDERS the spans
 * and never computes a value: the digits Tex shows are the digits the backend
 * sealed.
 *
 * Each surviving span is one line in the voice register (the display font, the
 * same `SpokenLine` the spoken answer uses), tagged with its credibility tier
 * using the EXISTING tex-tier idiom so it inherits the design system:
 *   - SEALED  → a solid mark; the line rests on sealed facts. A tiny PROOF
 *               affordance per SEALED span exposes its anchor_sha256 in the
 *               monospace id register (Geist Mono — ids are mono, Tex's spoken
 *               lines are the voice font).
 *   - ABSTAIN → the calm abstain moment: distinctly muted, no error affect. Tex
 *               simply doesn't have a sealed way to answer that yet.
 * (DERIVED is reserved in v1 — a span may still carry it, and the tier idiom
 *  renders it, but the pipeline emits only SEALED or ABSTAIN today.)
 *
 * `answerWord` is a global word index for the *whole* spoken text (spans speak
 * sequentially, concatenated), so a span only lights up while the voice is inside
 * its own token range — the same in-step highlight the voice answer already uses.
 * Pass -1 (the default) to render every line at full ink with no highlight.
 */

/* The one honest gloss per tier — chrome ABOUT the answer, never its meaning
   (the meaning is the span text itself, spoken). Mirrors lib/presence.js so the
   two answer surfaces read the same. */
const TIER_LABEL = { SEALED: "sealed", DERIVED: "derived", ABSTAIN: "abstained" };
const TIER_GLOSS = {
  SEALED: "grounded in a sealed fact",
  DERIVED: "derived from sealed facts",
  ABSTAIN: "unproven — Tex won't claim it",
};

const normTier = (v) => {
  const t = String(v || "").toUpperCase();
  return t === "SEALED" || t === "DERIVED" || t === "ABSTAIN" ? t : null;
};

/* The anchor a span links to: the span's own anchor_sha256, else the first
   sealed exhibit anchor among the exhibits the span's slots reference. Never
   fabricated — a span with no real anchor simply exposes no proof. */
function spanAnchor(span, exhibitsByHandle) {
  if (span?.anchor_sha256) return String(span.anchor_sha256);
  const slots = Array.isArray(span?.slots) ? span.slots : [];
  for (const s of slots) {
    const ex = exhibitsByHandle[s?.handle];
    if (ex?.anchor_sha256) return String(ex.anchor_sha256);
  }
  return null;
}

/* One span, one line: the voice-register text, its tier tag, and (SEALED only)
   the PROOF affordance that reveals the sealed anchor in the id register. */
function Span({ span, anchor, wordOffset, activeWord }) {
  const [open, setOpen] = useState(false);
  const tier = normTier(span?.verdict);
  const isAbstain = tier === "ABSTAIN";

  /* This span's local highlight index: the global voice word, shifted into the
     span's own token range. Outside the range → -1 (no highlight here). */
  const tokenCount = String(span?.text ?? "")
    .split(/(\s+)/)
    .filter((t) => t && !/^\s+$/.test(t)).length;
  let localWord = -1;
  if (activeWord >= 0) {
    const rel = activeWord - wordOffset;
    if (rel >= 0 && rel < tokenCount) localWord = rel;
  }

  return (
    <div className={`tex-span tex-span--${(tier || "sealed").toLowerCase()}`}>
      <p className="tex-span-line">
        <SpokenLine text={span?.text} active={localWord} />
      </p>

      {tier && (
        <p
          className={`tex-tier tex-tier--${tier.toLowerCase()}`}
          aria-label={`Credibility: ${TIER_LABEL[tier]} — ${TIER_GLOSS[tier]}`}
        >
          <span className="tex-tier-mark" aria-hidden="true" />
          <span className="tex-tier-label">{TIER_LABEL[tier]}</span>
          <span className="tex-tier-gloss">{TIER_GLOSS[tier]}</span>
        </p>
      )}

      {/* PROOF — a SEALED span rests on a real anchor. The affordance reveals it
          in the monospace id register (ids are mono; the spoken line stays the
          voice font). Nothing to reveal ⇒ no button; an abstain span never wears
          a proof (it is grounded in nothing, honestly). */}
      {tier === "SEALED" && anchor && (
        <div className="tex-span-proof">
          <button
            type="button"
            data-act="evidence"
            className="tex-claim tex-claim--proof"
            aria-expanded={open}
            aria-label={
              open ? "Hide the sealed anchor" : "Show the proof behind this line"
            }
            onClick={() => setOpen((v) => !v)}
          >
            <span className="tex-claim-cue" aria-hidden="true">
              {open ? "hide the proof" : "show the proof"}
            </span>
          </button>
          {open && (
            <p className="tex-span-anchor" role="status" aria-live="polite">
              {anchor}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function SpanAnswer({ answer, question, answerWord = -1 }) {
  const spans = Array.isArray(answer?.spans) ? answer.spans : [];
  if (!spans.length) return null;

  const exhibits = Array.isArray(answer?.exhibits) ? answer.exhibits : [];
  const exhibitsByHandle = {};
  for (const ex of exhibits) {
    if (ex?.handle) exhibitsByHandle[ex.handle] = ex;
  }

  /* The running word offset so each span's highlight range starts where the
     prior span's spoken text ended — the concatenated spoken_text the voice
     engine actually speaks, split the same way SpokenLine splits it. */
  let wordOffset = 0;

  return (
    <div className="tex-span-answer">
      {question && (
        <p className="tex-presence-question" aria-hidden="true">
          {question}
        </p>
      )}
      {spans.map((span, i) => {
        const offset = wordOffset;
        wordOffset += String(span?.text ?? "")
          .split(/(\s+)/)
          .filter((t) => t && !/^\s+$/.test(t)).length;
        return (
          <Span
            key={i}
            span={span}
            anchor={spanAnchor(span, exhibitsByHandle)}
            wordOffset={offset}
            activeWord={answerWord}
          />
        );
      })}
    </div>
  );
}
