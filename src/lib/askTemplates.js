/* ----------------------------------------------------------------------------
   askTemplates — grounded QUESTION completion for the typed line.

   The third register of the ghost, between the agent roster and the general
   word trie: when the WHOLE line being typed is a prefix of a question Tex
   can certifiably answer, the ghost completes the question itself — the
   Google-Suggest gesture, but over a closed, honest vocabulary.

   Doctrine: a template may ONLY be a question shape that maps onto a
   CERTIFIED plan primitive in the backend's compiler (COUNT / FILTER /
   RATIO / TOP_N / LATEST / EXISTS / LIST — tex/presence/plan/operators.py),
   with live-verified cousins ("878 forbidden of 5001 — 17.6%", "which agent
   acted the most", held/plane rooms). Never a speculative capability: a ghost
   that leads someone into an abstain is the completion being confidently
   wrong, which is the one sin the surface must never commit. When in doubt a
   shape stays OUT of this list.

   Matching is honest the same way the roster ghost is: the typed line must
   prefix-match (≥3 chars); ONE match completes fully; several matches
   complete only their longest COMMON prefix (every continuation shares it,
   so it can never be wrong); otherwise abstain ("").
---------------------------------------------------------------------------- */

/* Kept deliberately short and all-lowercase (the ghost continues a line the
   operator is composing; sentence case is theirs). Slotless by design — a
   question that needs an agent NAME is completed by the roster register once
   the name starts, not guessed here. */
export const TEMPLATES = [
  /* COUNT — the core tallies. */
  "how many agents are running",
  "how many actions were forbidden today",
  "how many actions were permitted today",
  "how many decisions are held",
  /* RATIO — live-verified ("17.6% of 5001"). */
  "what fraction of actions were forbidden today",
  /* TOP_N / LATEST — the compiler's own example shapes. */
  "which agent acted the most",
  "which agent acted last",
  /* LIST / EXISTS over the held room. */
  "which agents are held",
  "is anything held right now",
  /* LIST — "list three agents" is a compiler example. */
  "list the agents",
];

/* The completion SUFFIX for the line being typed, or "" to abstain. */
export function completeAsk(line) {
  const raw = String(line || "").replace(/^\s+/, "");
  if (raw.length < 3) return ""; /* too little intent to bet a question on */
  const lower = raw.toLowerCase();
  const hits = [];
  for (const t of TEMPLATES) {
    if (t.length > lower.length && t.startsWith(lower)) hits.push(t);
  }
  if (hits.length === 0) return "";
  if (hits.length === 1) return hits[0].slice(lower.length);
  /* Several live continuations: complete only what they ALL share. */
  let lcp = hits[0];
  for (const h of hits) {
    let i = 0;
    const n = Math.min(lcp.length, h.length);
    while (i < n && lcp[i] === h[i]) i += 1;
    lcp = lcp.slice(0, i);
  }
  return lcp.length > lower.length ? lcp.slice(lower.length) : "";
}
