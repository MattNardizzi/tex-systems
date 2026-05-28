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
 * Four rules that govern every function in this file:
 *
 *   1. Tex always says "I". Never "the system", "agents are", or any
 *      passive-voice variant. Subject is Tex, every sentence.
 *
 *   2. Every sentence is something Tex DID, not something Tex is
 *      observing. Past tense, perfect tense — never present-tense
 *      status reporting. "I watched all night" not "I'm watching".
 *      "All of them stayed in the bounds I gave them" not "all of
 *      them are who they say they are". A warden recounts the night.
 *      A camera reports current readings. Tex is the warden.
 *
 *   3. The head plants an action. The tail leans in and names a
 *      specific thing. The head must be true at every load. The tail
 *      only appears when there is a specific thing to name.
 *
 *   4. Empty state is honest state — and in B, empty state is still
 *      something Tex stands behind. Not "I haven't done anything yet"
 *      (passive, absence) but "I'm ready" / "I'm set up to" / "the
 *      moment they appear, I'll have them". Tex is never waiting in
 *      a default sense; Tex is ready, posture forward.
 *
 * These functions are pure: same input → same output, no side effects,
 * no clocks beyond what the input carries.
 */

/* ------------------------------------------------------------------ */
/* Small helpers — words, not numbers, where Tex would say words.     */
/* ------------------------------------------------------------------ */

/* For small counts Tex spells the word. "Eighty-three agents" reads
   as a being talking; "83 agents" reads as a dashboard cell. Past 100
   we let the digits stand. */
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
  return n.toLocaleString("en-US");
}

function pluralize(count, singular, plural) {
  return count === 1 ? singular : plural || `${singular}s`;
}

function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ------------------------------------------------------------------ */
/* Layer 1 — Discovery                                                 */
/*                                                                     */
/* B voice: Tex meets and seals in the same breath. The sealing is     */
/* the act, not a footnote. Empty state is "I'm set up to meet them";  */
/* steady state is "I met N and sealed each one"; change in tail.      */
/* ------------------------------------------------------------------ */

export function discovery(state) {
  const lastScan = state?.last_scan ?? {};
  const drift = state?.latest_drift ?? [];

  /* No scan has ever run. Posture forward: Tex is ready, not absent. */
  if (!lastScan.has_run) {
    return { head: "The moment your agents appear, I'll meet them and seal each one." };
  }

  const seen = lastScan.candidates_seen ?? 0;
  const registered = lastScan.registered_count ?? 0;
  const quiet = drift.filter((e) =>
    String(e.kind || "").toUpperCase().includes("DISAPPEAR")
  ).length;

  /* Scans happened, none found this round. Still B — Tex looked. */
  if (seen === 0) {
    return { head: "I looked tonight. None of your agents were in the room." };
  }

  const head = `I met ${spell(seen)} of your agents. I sealed each one as I found them.`;

  const tailParts = [];
  if (registered > 0) {
    tailParts.push(
      registered === 1
        ? "One came in this week."
        : `${capitalize(spell(registered))} came in this week.`
    );
  }
  if (quiet > 0) {
    tailParts.push(
      quiet === 1 ? "I noticed one go quiet." : `I noticed ${spell(quiet)} go quiet.`
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
/* B voice: Tex gave the bounds, Tex watches them, Tex holds the line  */
/* when one is crossed. Subject is Tex, not the agents. Past tense.    */
/* ------------------------------------------------------------------ */

export function identity(state) {
  const totalAgents = state?.governance?.total_agents ?? 0;
  const drift = state?.latest_drift ?? [];

  if (totalAgents === 0) {
    return { head: "I'll give each one its bounds the moment I meet it." };
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

  const head = "All of them stayed in the bounds I gave them.";

  if (identityHolds === 0) {
    return { head };
  }
  if (identityHolds === 1) {
    return { head: "All but one stayed in the bounds I gave them.", tail: "One reached for more. I held the line." };
  }
  return {
    head: `All but ${spell(identityHolds)} stayed in the bounds I gave them.`,
    tail: `${capitalize(spell(identityHolds))} reached for more. I held the line each time.`,
  };
}

/* ------------------------------------------------------------------ */
/* Layer 3 — Monitoring                                                */
/*                                                                     */
/* B voice: the biggest flip in the file. "I watched" not              */
/* "I'm watching". A warden closes the loop — the watching is done,    */
/* the report is the result. No open-ended "I'll tell you the moment". */
/* ------------------------------------------------------------------ */

export function monitoring(state) {
  const drift = state?.latest_drift ?? [];
  const presenceOn = state?.scheduler?.presence_tracker_enabled ?? false;
  const totalAgents = state?.governance?.total_agents ?? 0;

  if (totalAgents === 0) {
    if (presenceOn) {
      return { head: "I'm posted. The moment one appears, I have it." };
    }
    return { head: "I'm posted and ready to watch the room." };
  }

  if (drift.length === 0) {
    return { head: "I watched them all night. Nothing moved." };
  }

  const mostRecent = drift[0];
  const summary = mostRecent?.summary;
  if (summary) {
    return { head: "I watched them all night. Something shifted.", tail: `${summary} I have it.` };
  }
  if (drift.length === 1) {
    return { head: "I watched them all night.", tail: "Something shifted. I have it." };
  }
  return {
    head: "I watched them all night.",
    tail: `${capitalize(spell(drift.length))} things shifted. I have them.`,
  };
}

/* ------------------------------------------------------------------ */
/* Layer 4 — Execution Governance                                      */
/*                                                                     */
/* B voice: Tex owns the verdict. Lead with the act (let through,      */
/* stopped), not the count. The count moves into the tail. When        */
/* there's been a block, "I stopped one" is the owned sentence the     */
/* whole industry is afraid to say.                                    */
/* ------------------------------------------------------------------ */

export function execution(state) {
  const decisions = state?.decisions;
  if (decisions && typeof decisions.total === "number") {
    const { total, permits = 0, forbids = 0 } = decisions;
    if (total === 0) {
      return { head: "Nothing crossed my desk yet. I'm ready when it does." };
    }
    if (forbids === 0 && permits === total) {
      return { head: "I let through everything that should pass.", tail: total <= 20 ? `${capitalize(spell(total))} ${pluralize(total, "decision")}, all clean.` : `${total.toLocaleString("en-US")} decisions, all clean.` };
    }
    if (forbids === 0) {
      return {
        head: "I let through everything that should pass.",
        tail: `I allowed ${permits.toLocaleString("en-US")} today.`,
      };
    }
    if (forbids === 1) {
      return {
        head: "I let through what should pass. I stopped one.",
        tail: `${permits.toLocaleString("en-US")} allowed, one held.`,
      };
    }
    return {
      head: `I let through what should pass. I stopped ${spell(forbids)}.`,
      tail: `${permits.toLocaleString("en-US")} allowed, ${spell(forbids)} held.`,
    };
  }

  const ledgerLen = state?.chain?.discovery_ledger_length ?? 0;
  if (ledgerLen === 0) {
    return { head: "Nothing's needed me to decide yet. I'm ready when it does." };
  }
  return { head: "I'm posted at the gate. Nothing's asked yet." };
}

/* ------------------------------------------------------------------ */
/* Layer 5 — Evidence                                                  */
/*                                                                     */
/* B voice: no hedge. "I can prove all of it" replaces "if anyone      */
/* ever asks, I can prove every one." A warden stands behind the       */
/* proof unconditionally. "As it happened" claims the moment of        */
/* sealing — the gap competitors leave open.                           */
/* ------------------------------------------------------------------ */

export function evidence(state) {
  const chain = state?.chain ?? {};
  const ledgerLen = chain.discovery_ledger_length ?? 0;
  const intact =
    (chain.discovery_chain_intact ?? true) &&
    (chain.snapshot_chain_intact ?? true);
  const durable = chain.durable_persistence ?? false;

  if (ledgerLen === 0) {
    if (durable) {
      return {
        head: "I'm ready to write everything down as it happens.",
        tail: "The proof will be there from the first moment.",
      };
    }
    return { head: "I'm setting up the place where I'll write everything down." };
  }

  if (!intact) {
    return {
      head: "I wrote everything down as it happened.",
      tail: "Something in the chain doesn't add up. You should see this.",
    };
  }
  return {
    head: "I wrote everything down as it happened.",
    tail: `I can prove all ${ledgerLen.toLocaleString("en-US")} of them.`,
  };
}

/* ------------------------------------------------------------------ */
/* Layer 6 — Learning                                                  */
/*                                                                     */
/* B voice: this is the one sentence where Tex defers. The five other  */
/* layers own actions Tex took; this one names an action Tex didn't    */
/* take yet, on purpose. Changing Tex's own behavior is the one thing  */
/* a warden shouldn't do unilaterally. "Use it" → "act on it" makes    */
/* the deferral active rather than passive.                            */
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
        tail: "Nothing I'd ask you to sign off on yet.",
      };
    }
    if (pending === 1) {
      return {
        head: "I learned something this week.",
        tail: "I'd like your sign-off before I act on it.",
      };
    }
    return {
      head: `I learned ${spell(pending)} ${pluralize(pending, "thing")} this week.`,
      tail: "I'd like your sign-off before I act on them.",
    };
  }

  /* No proposals data fetched yet (or none exist). */
  return { head: "I've been learning your shop, quietly." };
}

/* ------------------------------------------------------------------ */
/* The standing word — Absolute / Open                                 */
/*                                                                     */
/* The top of the vigil stage is one word, in a serif glass treatment. */
/* It does not cycle. It does not change with the rotating sentences   */
/* beneath it. It is Tex's standing posture, and it is binary:         */
/*                                                                     */
/*   Absolute. — Tex has the night. Nothing is unresolved.             */
/*   Open.     — Something is unresolved. The word changes the moment  */
/*               Tex cannot stand fully behind the calm.               */
/*                                                                     */
/* There is no middle. The whole point of the word is that it does     */
/* not bend. When Tex cannot say Absolute, Tex says the other word.    */
/* ------------------------------------------------------------------ */

export function absoluteState(state) {
  /* Empty state — Tex is set up and posted. Readiness is a state    */
  /* Tex stands behind, so empty state is still Absolute.             */
  if (!state) return { word: "Absolute" };

  const chain = state.chain ?? {};

  /* The chain breaking is the one thing Tex cannot stand silently  */
  /* behind. It dislodges the standing posture immediately.          */
  const chainIntact =
    (chain.discovery_chain_intact ?? true) &&
    (chain.snapshot_chain_intact ?? true);
  if (!chainIntact) {
    return { word: "Open", reason: "chain" };
  }

  /* A pending learning proposal is also Open — Tex wants the        */
  /* operator to look at something and will not act until it hears   */
  /* back. The vigil reads as Open until the operator decides.       */
  const proposals = state.learning_proposals;
  if (Array.isArray(proposals)) {
    const pending = proposals.filter(
      (p) => String(p.status || "").toUpperCase() === "PENDING"
    ).length;
    if (pending > 0) {
      return { word: "Open", reason: "proposal" };
    }
  }

  /* Identity holds and decisions stopped are Absolute — Tex stood   */
  /* behind the holding. They land in the rotating sentences below.  */
  return { word: "Absolute" };
}

/* ------------------------------------------------------------------ */
/* Composition                                                         */
/*                                                                     */
/* The rotating sentences underneath the standing word are the         */
/* Jobs cut: three sentences, not six. Discovery, monitoring, and      */
/* evidence become silent foundation. The three that speak are the     */
/* three a being would actually mention: bounds, gate, growth.         */
/* ------------------------------------------------------------------ */

export const VIGIL_LAYERS = [
  { key: "identity", speak: identity },
  { key: "execution", speak: execution },
  { key: "learning", speak: learning },
];

/* The full six remain exported so the threshold door and any future
   surface (proof layer, evidence drill-in) can still reach them. */
export const ALL_LAYERS = [
  { key: "discovery", speak: discovery },
  { key: "identity", speak: identity },
  { key: "monitoring", speak: monitoring },
  { key: "execution", speak: execution },
  { key: "evidence", speak: evidence },
  { key: "learning", speak: learning },
];

/**
 * Take a snapshot, return the sentences for the given layer list.
 * Defaults to VIGIL_LAYERS (the three vigil sentences). Pass ALL_LAYERS
 * (or any subset) to get a different set — used by the threshold door
 * to fetch discovery/monitoring/execution for the day-two opener.
 *
 * Returns [{ key, head, tail? }, ...] of the same length as `layers`.
 *
 * If `state` is null (first load before the API has returned), every
 * sentence renders as the ready/posted variant — Tex is still standing
 * behind something. No skeletons, no spinners.
 */
export function speak(state, layers = VIGIL_LAYERS) {
  return layers.map(({ key, speak }) => {
    const sentence = speak(state ?? null);
    return { key, ...sentence };
  });
}
