/**
 * texVoice.js
 *
 * Tex's voice, derived from the system state.
 *
 * Six pure functions. One per architectural layer. Each takes the
 * relevant slice of the SystemStateResponse and returns a sentence
 * shaped as { head, tail } — upright head in full ink, italic tail
 * in soft ink. When the tail isn't earned, the function returns
 * { head } and the vigil renders without a tail.
 *
 * Three rules that govern every function in this file:
 *
 *   1. Tex always says "I". Never "the system", "agents are", or any
 *      passive-voice variant. If the sentence cannot be said by a being
 *      who also says "I held the line", rewrite it until it can.
 *
 *   2. The head plants a fact. The tail leans in and says what it means.
 *      The head must be true at every load. The tail only appears when
 *      there is something to lean in about. "Coverage is at 71%" is a
 *      tail. "It is steady" is not a tail; it is decoration.
 *
 *   3. Empty state is honest state. An operator on day one sees an
 *      honest empty product. "I haven't met any of your agents yet" is
 *      a true Tex sentence. It changes the instant a scan runs.
 *
 * These functions are pure: same input → same output, no side effects,
 * no clocks beyond what the input carries. That's deliberate. The voice
 * has to be testable in isolation so it cannot drift quietly.
 */

/* ------------------------------------------------------------------ */
/* Small helpers — words, not numbers, where Tex would say words.     */
/* ------------------------------------------------------------------ */

/* For small counts Tex spells the word. "Eighty-three agents" reads
   as a being talking; "83 agents" reads as a dashboard cell. Past 100
   we let the digits stand — Tex would say "four thousand eight hundred
   and twenty-seven" only in a country song. */
const SMALL_NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
];
function spell(n) {
  if (n == null) return "";
  if (n <= 20) return SMALL_NUMBER_WORDS[n];
  if (n < 100) {
    const tens = [
      "",
      "",
      "twenty",
      "thirty",
      "forty",
      "fifty",
      "sixty",
      "seventy",
      "eighty",
      "ninety",
    ];
    const t = Math.floor(n / 10);
    const o = n % 10;
    return o === 0 ? tens[t] : `${tens[t]}-${SMALL_NUMBER_WORDS[o]}`;
  }
  /* 100+: render as digits with thousands separator. */
  return n.toLocaleString("en-US");
}

/* "1 agent" vs "two agents". The pluralization is intentional. Tex is
   careful with grammar because a being is. */
function pluralize(count, singular, plural) {
  return count === 1 ? singular : plural || `${singular}s`;
}

/* ------------------------------------------------------------------ */
/* Layer 1 — Discovery                                                */
/*                                                                     */
/* The discovery sentence speaks from last_scan.candidates_seen,       */
/* last_scan.registered_count, and the count of CONFIRMED_DISAPPEARED  */
/* events in latest_drift. Coverage moves get folded into the tail     */
/* when they shift, per the principle that the same number a Splunk   */
/* dashboard would chart, Tex says in a sentence.                     */
/* ------------------------------------------------------------------ */

export function discovery(state) {
  const lastScan = state?.last_scan ?? {};
  const drift = state?.latest_drift ?? [];

  /* No scan has ever run. Honest empty state. */
  if (!lastScan.has_run) {
    return { head: "I haven't met any of your agents yet." };
  }

  const seen = lastScan.candidates_seen ?? 0;
  const registered = lastScan.registered_count ?? 0;
  const quiet = drift.filter((e) =>
    String(e.kind || "").toUpperCase().includes("DISAPPEAR")
  ).length;

  /* Some scans have happened but found nothing this round. */
  if (seen === 0) {
    return { head: "I looked, and didn't find any of your agents this time." };
  }

  const head = `I found ${spell(seen)} ${pluralize(seen, "agent")} this week.`;

  const tailParts = [];
  if (registered > 0) {
    tailParts.push(
      registered === 1
        ? "One was new."
        : `${capitalize(spell(registered))} were new.`
    );
  }
  if (quiet > 0) {
    tailParts.push(
      quiet === 1 ? "One had gone quiet." : `${capitalize(spell(quiet))} had gone quiet.`
    );
  }

  if (tailParts.length === 0) {
    return { head };
  }
  return { head, tail: tailParts.join(" ") };
}

/* ------------------------------------------------------------------ */
/* Layer 2 — Identity                                                  */
/*                                                                     */
/* "All of them are who they say they are" is the steady-state head    */
/* once there are agents and no identity findings. When agents have    */
/* asked for capabilities beyond what they're allowed, the tail names  */
/* the holding action. With zero agents, this layer stays silent       */
/* about identity and pivots to a quieter truth.                       */
/* ------------------------------------------------------------------ */

export function identity(state) {
  const totalAgents = state?.governance?.total_agents ?? 0;
  const drift = state?.latest_drift ?? [];

  if (totalAgents === 0) {
    return { head: "When I meet your agents, I'll know who each one is." };
  }

  const identityHolds = drift.filter((e) => {
    const kind = String(e.kind || "").toUpperCase();
    const severity = String(e.severity || "").toUpperCase();
    return (
      kind.includes("CAPABILITY") ||
      kind.includes("IDENTITY") ||
      kind.includes("FORBID") ||
      severity === "HIGH" ||
      severity === "CRITICAL"
    );
  }).length;

  const head = "All of them are who they say they are.";

  if (identityHolds === 0) {
    return { head };
  }
  if (identityHolds === 1) {
    return { head, tail: "One asked for more than I'd given it. I held the line." };
  }
  return {
    head,
    tail: `${capitalize(spell(identityHolds))} asked for more than I'd given them. I held the line each time.`,
  };
}

/* ------------------------------------------------------------------ */
/* Layer 3 — Monitoring                                                */
/*                                                                     */
/* The monitoring sentence speaks from scheduler.presence_tracker_     */
/* enabled and the count of drift events in the rolling window. When  */
/* nothing is drifting, Tex says so plainly. When something is, the   */
/* tail names the most recent.                                        */
/* ------------------------------------------------------------------ */

export function monitoring(state) {
  const drift = state?.latest_drift ?? [];
  const presenceOn = state?.scheduler?.presence_tracker_enabled ?? false;
  const totalAgents = state?.governance?.total_agents ?? 0;

  if (totalAgents === 0) {
    if (presenceOn) {
      return { head: "I'm watching for them. Nothing yet." };
    }
    return { head: "I'm not watching anything yet." };
  }

  if (drift.length === 0) {
    return {
      head: "I'm watching them all, right now. Nothing is drifting.",
      tail: "I'll tell you the moment something does.",
    };
  }

  const mostRecent = drift[0];
  const summary = mostRecent?.summary;
  const head = "I'm watching them all, right now.";
  if (summary) {
    return { head, tail: summary };
  }
  return { head, tail: `${drift.length} ${pluralize(drift.length, "thing")} ${drift.length === 1 ? "is moving" : "are moving"}. I'm holding the line.` };
}

/* ------------------------------------------------------------------ */
/* Layer 4 — Execution Governance                                      */
/*                                                                     */
/* This sentence speaks from the decision counts. The current          */
/* /v1/system/state payload does not yet expose a daily decision       */
/* summary; until it does, this function renders an honest empty state */
/* when there's no governance activity, and is shaped to swap in real  */
/* counts the moment the backend surfaces them on the response.        */
/* ------------------------------------------------------------------ */

export function execution(state) {
  /* When the backend grows a decisions block, plug it in here. The
     contract: state.decisions = { total, permits, abstains, forbids,
     window_label }. Until then we read from governance + chain to
     produce an honest sentence. */
  const decisions = state?.decisions;
  if (decisions && typeof decisions.total === "number") {
    const { total, permits = 0, forbids = 0 } = decisions;
    const head = `I made ${total.toLocaleString("en-US")} ${pluralize(total, "decision")} today.`;
    if (forbids === 0 && permits === total) {
      return { head, tail: "I let every one of them through." };
    }
    if (forbids === 0) {
      return { head, tail: `I allowed ${permits.toLocaleString("en-US")} of them.` };
    }
    return {
      head: `I made ${total.toLocaleString("en-US")} ${pluralize(total, "decision")} today. I allowed ${permits.toLocaleString("en-US")}.`,
      tail:
        forbids === 1
          ? "I stopped one."
          : `I stopped ${spell(forbids)}.`,
    };
  }

  const ledgerLen = state?.chain?.discovery_ledger_length ?? 0;
  if (ledgerLen === 0) {
    return { head: "I haven't had to decide anything yet." };
  }
  return { head: "I'm ready to decide. Nothing has asked yet." };
}

/* ------------------------------------------------------------------ */
/* Layer 5 — Evidence                                                  */
/*                                                                     */
/* The evidence sentence speaks from state.chain. It is the only       */
/* sentence in the vigil where Tex is allowed to almost-boast,         */
/* because evidence integrity is what Tex is built around.             */
/* ------------------------------------------------------------------ */

export function evidence(state) {
  const chain = state?.chain ?? {};
  const ledgerLen = chain.discovery_ledger_length ?? 0;
  const intact =
    (chain.discovery_chain_intact ?? true) &&
    (chain.snapshot_chain_intact ?? true);
  const durable = chain.durable_persistence ?? false;

  if (ledgerLen === 0) {
    /* Tex is set up to write things down. There's just nothing to
       write down yet. Honest. */
    if (durable) {
      return {
        head: "I'm ready to write everything down.",
        tail: "When something happens, I'll have the proof.",
      };
    }
    return { head: "I'll be ready to write everything down once I'm fully set up." };
  }

  const head = "I wrote it all down.";
  if (!intact) {
    return {
      head,
      tail: "Something in the chain doesn't add up. You should see this.",
    };
  }
  return {
    head,
    tail: `If anyone ever asks, I can prove every one of the ${ledgerLen.toLocaleString("en-US")}.`,
  };
}

/* ------------------------------------------------------------------ */
/* Layer 6 — Learning                                                  */
/*                                                                     */
/* The learning sentence speaks from pending calibration proposals.    */
/* The current /v1/system/state payload does not include proposals;    */
/* the hook is allowed to pass them in as a sibling field once the     */
/* learning_proposals fetch is wired. Until then, honest empty state.  */
/* ------------------------------------------------------------------ */

export function learning(state) {
  const proposals = state?.learning_proposals;
  if (proposals && Array.isArray(proposals)) {
    const pending = proposals.filter(
      (p) => String(p.status || "").toUpperCase() === "PENDING"
    ).length;
    if (pending === 0) {
      return {
        head: "I've been learning, quietly.",
        tail: "Nothing to bring you yet.",
      };
    }
    if (pending === 1) {
      return {
        head: "I learned something this week.",
        tail: "I'd like your sign-off before I use it.",
      };
    }
    return {
      head: `I learned ${spell(pending)} ${pluralize(pending, "thing")} this week.`,
      tail: "I'd like your sign-off before I use them.",
    };
  }

  /* No proposals data fetched yet (or none exist). */
  return { head: "I'm still learning your shop." };
}

/* ------------------------------------------------------------------ */
/* Composition                                                         */
/*                                                                     */
/* The vigil cycles in this order. Each entry pairs the layer key      */
/* (used by the proof layer to know which detail fetch to run) with    */
/* the function that produces the sentence from the snapshot.          */
/* ------------------------------------------------------------------ */

export const VIGIL_LAYERS = [
  { key: "discovery", speak: discovery },
  { key: "identity", speak: identity },
  { key: "monitoring", speak: monitoring },
  { key: "execution", speak: execution },
  { key: "evidence", speak: evidence },
  { key: "learning", speak: learning },
];

/**
 * Take a snapshot, return all six sentences in vigil order.
 * Returns [{ key, head, tail? }, ...] of length 6.
 *
 * If `state` is null (first load before the API has returned), every
 * sentence renders as the no-knowledge variant — Tex is still being
 * truthful. No skeletons, no spinners.
 */
export function speak(state) {
  return VIGIL_LAYERS.map(({ key, speak }) => {
    const sentence = speak(state ?? null);
    return { key, ...sentence };
  });
}

/* ------------------------------------------------------------------ */

function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
