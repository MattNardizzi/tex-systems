/* ============================================================
   StyleGallery — DEV-ONLY visual harness for the whole surface.

   Renders every Vigil surface (door, mapping, held, deliberation,
   voice, presence answer + tiers + evidence, object, seal, roster)
   with mock content, using the REAL class names and the REAL
   Vigil.css — so the entire design system can be seen and iterated
   without a backend.

   Usage (DEV only, stripped from prod via import.meta.env.DEV):
     /?gallery            → all surfaces stacked (for scrolling)
     /?gallery=held       → ONE surface, full-screen (for clean screenshots)

   It never touches the live Vigil logic — it only re-uses its styles.
   ============================================================ */
import "../components/Dashboard/Vigil.css";
import "./gallery.css";
import SpokenLine from "../components/Dashboard/SpokenLine";
import SealAnchor from "../components/Dashboard/SealAnchor";
import MappingMark from "../components/Dashboard/MappingMark";

/* Mock anchor — a true 64-char sha256 shape, so the seal harness exercises
   the same lock the live card runs on a real anchor. */
const HASH = "9f2c4a7b8e1d3056c2a9f1e4b7d80c6a5f3e2b1d9c8a7065f4e3d2c1b0a9f8e7";

/* The surface inventory — id → { label, faltering?, node }. Order is the product's
   own narrative order. Each renders inside its own full-height .tex-field so the
   real absolute-centering and flex-centering both reproduce exactly. */
const SURFACES = {
  door: {
    label: "01 · door — manifesto + begin",
    node: (
      <div className="tex-door" role="group" aria-label="Tex">
        <p className="tex-door-sentence tex-door-line tex-door-line--hold">
          <SpokenLine text="The weight is mine now." active={-1} />
        </p>
        <div className="tex-acts tex-door-acts is-revealed">
          <button type="button" data-act="begin" className="tex-act tex-act--approve">
            Begin
          </button>
        </div>
      </div>
    ),
  },
  wake: {
    label: "01b · door — wake invitation",
    node: (
      <div className="tex-door">
        <p className="tex-door-sentence tex-door-wake">touch to wake Tex</p>
      </div>
    ),
  },
  manifesto1: {
    label: "01c · door — declaration",
    node: (
      <div className="tex-door">
        <p className="tex-door-sentence tex-door-line">
          <SpokenLine text="I am Tex." active={-1} />
        </p>
      </div>
    ),
  },
  manifesto2: {
    label: "01d · door — dominion",
    node: (
      <div className="tex-door">
        <p className="tex-door-sentence tex-door-line">
          <SpokenLine text="Nothing happens without me." active={-1} />
        </p>
      </div>
    ),
  },
  mapping: {
    label: "02 · mapping",
    node: (
      <div className="tex-door">
        <p className="tex-door-sentence tex-mapping">Mapping</p>
        <MappingMark />
      </div>
    ),
  },
  held: {
    label: "03 · held decision",
    node: (
      <div className="tex-held">
        <p className="tex-held-sentence">
          A wire wants to move $40,000 to an account I've never seen.
        </p>
        <p className="tex-held-detail">
          ClaimPulse opened it nine seconds ago. Everything checks but the
          destination, and that one thing I can't vouch for.
        </p>
        <div className="tex-held-hold">
          <p className="tex-held-type">There's one thing I'd need to know.</p>
          <p className="tex-held-question">
            Have you sent money to this account before?
          </p>
        </div>
        <div className="tex-acts">
          <button type="button" data-act="approve" className="tex-act tex-act--approve">
            Approve
          </button>
          <button type="button" data-act="hold" className="tex-act tex-act--hold">
            Keep holding
          </button>
          <button type="button" data-act="refuse" className="tex-act tex-act--refuse">
            Refuse
          </button>
        </div>
        <p className="tex-held-cert" aria-hidden="true">
          certified hold · band [0.31, 0.34]
        </p>
        <p className="tex-held-ask" aria-hidden="true">
          press and hold anywhere to ask Tex about it
        </p>
      </div>
    ),
  },
  deliberation: {
    label: "04 · deliberation",
    node: (
      <div className="tex-deliberation" role="status">
        <span className="tex-deliberation-mark" aria-hidden="true" />
      </div>
    ),
  },
  here: {
    label: "05 · voice — here",
    node: (
      <div className="tex-voice">
        <p className="tex-voice-line tex-voice-line--here">Here.</p>
      </div>
    ),
  },
  ignite: {
    label: "05b · voice — ignition count",
    node: (
      <div className="tex-voice">
        <p className="tex-voice-line tex-voice-line--ignite">
          <SpokenLine text="You have two hundred agents running. I'll begin." active={-1} />
        </p>
      </div>
    ),
  },
  falter: {
    label: "05c · voice — faltering",
    faltering: true,
    node: (
      <div className="tex-voice">
        <p className="tex-voice-line tex-voice-line--falter">
          My evidence chain broke. I can't prove what I've sealed since.
        </p>
      </div>
    ),
  },
  "presence-sealed": {
    label: "06 · presence — sealed + evidence",
    node: (
      <div className="tex-presence">
        <p className="tex-presence-line">
          <SpokenLine text="Two hundred and six. Nineteen I can't see into." active={-1} />
        </p>
        <p className="tex-tier tex-tier--sealed" aria-label="Credibility: sealed">
          <span className="tex-tier-mark" aria-hidden="true" />
          <span className="tex-tier-label">sealed</span>
          <span className="tex-tier-gloss">grounded in a sealed fact</span>
        </p>
        <div className="tex-evidence">
          <button type="button" data-act="evidence" className="tex-claim">
            <span className="tex-claim-text">206 agents under seal</span>
            <span className="tex-claim-cue" aria-hidden="true">proof</span>
          </button>
          <button type="button" data-act="evidence" className="tex-claim">
            <span className="tex-claim-text">19 outside the identity plane</span>
            <span className="tex-claim-cue" aria-hidden="true">proof</span>
          </button>
        </div>
        <div className="tex-object tex-object--in-presence" role="status">
          <span className="tex-object-value">{HASH}</span>
        </div>
      </div>
    ),
  },
  "presence-derived": {
    label: "06b · presence — derived",
    node: (
      <div className="tex-presence">
        <p className="tex-presence-line">
          <SpokenLine text="About a third are touching production." active={-1} />
        </p>
        <p className="tex-tier tex-tier--derived" aria-label="Credibility: derived">
          <span className="tex-tier-mark" aria-hidden="true" />
          <span className="tex-tier-label">derived</span>
          <span className="tex-tier-gloss">derived from sealed facts</span>
        </p>
        <div className="tex-evidence">
          <button type="button" data-act="evidence" className="tex-claim tex-claim--proof">
            <span className="tex-claim-cue" aria-hidden="true">show the proof</span>
          </button>
        </div>
      </div>
    ),
  },
  "presence-abstain": {
    label: "06c · presence — abstained",
    node: (
      <div className="tex-presence">
        <p className="tex-presence-line">
          <SpokenLine text="I can't prove that one. I won't claim it." active={-1} />
        </p>
        <p className="tex-tier tex-tier--abstain" aria-label="Credibility: abstained">
          <span className="tex-tier-mark" aria-hidden="true" />
          <span className="tex-tier-label">abstained</span>
          <span className="tex-tier-gloss">unproven — Tex won't claim it</span>
        </p>
      </div>
    ),
  },
  object: {
    label: "07 · object — the held handle",
    node: (
      <div className="tex-object" role="status">
        <span className="tex-object-value">{HASH}</span>
      </div>
    ),
  },
  seal: {
    label: "08 · seal",
    node: (
      <div className="tex-seal" role="status">
        <p className="tex-seal-tag tex-seal-tag--sealed">
          <span className="tex-seal-tag-mark" aria-hidden="true" />
          <span className="tex-seal-tag-label">sealed</span>
        </p>
        <SealAnchor hash={HASH} />
        <p className="tex-seal-hash">3:42:07 PM</p>
        <p className="tex-seal-sig">post-quantum sealed&nbsp;·&nbsp;ML-DSA-65</p>
      </div>
    ),
  },
  roster: {
    label: "09 · roster",
    node: (
      <div className="tex-roster">
        <ul className="tex-roster-list">
          {[
            ["ClaimPulse", "active", "in-path-blocking"],
            ["AtlasPay", "active", "credential-enforced"],
            ["Meridian-7", "idle", "decide-only"],
            ["VectorDesk", "active", "decide-only"],
          ].map(([name, state, plane]) => (
            <li key={name} className="tex-roster-row">
              <span className="tex-roster-name">{name}</span>
              <span className="tex-roster-state">{state}</span>
              <span className={`tex-plane-badge tex-plane-badge--${plane}`}>
                {plane.replace(/-/g, " ")}
              </span>
            </li>
          ))}
        </ul>
      </div>
    ),
  },
};

const STATUS = {
  door: "Awaiting",
  wake: "Awaiting",
  manifesto1: "Awaiting",
  manifesto2: "Awaiting",
  mapping: "Mapping",
  held: "Decision held",
  deliberation: "Weighing",
  here: "Watching",
  ignite: "Watching",
  falter: "Chain broken",
  "presence-sealed": "Watching",
  "presence-derived": "Watching",
  "presence-abstain": "Watching",
  object: "Watching",
  seal: "Sealed",
  roster: "Watching",
};

/* The operating frame, mirrored from Vigil so each surface previews with its
   real chrome. */
function Frame({ status }) {
  return (
    <div className="tex-frame" aria-hidden="true">
      <span className="tex-frame-label tex-frame-tl">Tex</span>
      <span className="tex-frame-label tex-frame-tr">Sovereign Cognition</span>
      <span className="tex-frame-rule tex-frame-rule--top" />
      <span className="tex-frame-rule tex-frame-rule--bot" />
      <span className="tex-frame-label tex-frame-bl">
        <span className="tex-frame-live" />
        {status}
      </span>
      <span className="tex-frame-label tex-frame-br">v1.0</span>
    </div>
  );
}

function Screen({ id }) {
  const s = SURFACES[id];
  if (!s) return null;
  return (
    <section
      className={"tex-field" + (s.faltering ? " tex-field--faltering" : "")}
      data-gallery={id}
      style={{ cursor: "default" }}
    >
      <Frame status={STATUS[id] || "Watching"} />
      <span className="gallery-tag">{s.label}</span>
      {s.node}
    </section>
  );
}

export default function StyleGallery() {
  const params = new URLSearchParams(window.location.search);
  const only = params.get("gallery");
  const ids = only && SURFACES[only] ? [only] : Object.keys(SURFACES);
  return (
    <div className="gallery-root">
      {ids.map((id) => (
        <Screen key={id} id={id} />
      ))}
    </div>
  );
}
