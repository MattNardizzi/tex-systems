import { useEffect, useRef, useState } from "react";
import "./Vigil.css";

/* ============================================================
   Vigil — the entire product surface.

   One screen. One voice. Three depths.

   PHASE: door
   The four lines, large serif, centered. Held long enough to
   read. Then they dissolve, and Tex begins.

   PHASE: vigil
   Six summary sentences cycle. One at a time, in the same
   place, in the same size, in the same voice. Tex paces the
   rhythm. Each sentence holds, then dissolves, then the next
   one arrives. After the sixth, Tex returns to the first.
   The vigil does not end.

   PHASE: proof
   The operator clicks a sentence. The summary dissolves. In
   its place, Tex finishes the story of that one thing — three
   short sentences in the same voice on the same canvas.
   Underneath, in smaller italic, a quiet anchor line. If the
   operator hovers the anchor, the cryptographic hash appears
   in monospace.

   After a beat of stillness, Tex returns to the vigil — not
   to the same sentence, but to the next one in sequence. Tex
   has moved on. The conversation continues.

   Hovering pauses pacing. The operator can hold any sentence
   as long as they want. When they leave, Tex resumes.

   Nothing in this surface is a modal. Nothing is a tab.
   Nothing is a button that does not sound like Tex talking.
   There is no back button. There is no "next." Tex is the
   pacing.
   ============================================================ */

/* Door pacing — each line owns its moment.

   The first line arrives in silence. It sits alone long enough to
   be a thought, not a label. Then the next line slowly materializes
   beneath it. Then the next. The pause between lines is the drama.

   Total door experience:
     0.5s   — silence (page is empty)
     +1.0s  — line 1 fades in       (line 1 finishes at 1.5s)
     +1.0s  — silence
     +1.0s  — line 2 fades in       (line 2 finishes at 3.5s)
     +1.0s  — silence
     +1.0s  — line 3 fades in       (line 3 finishes at 5.5s)
     +1.0s  — silence
     +1.0s  — line 4 fades in       (line 4 finishes at 7.5s)
     +2.5s  — all four hold as one thought
     = 10.0s before the door dissolves into the vigil */
const DOOR_LINE_STAGGER_MS = 2000;  /* time between each line starting */
const DOOR_LINE_FADE_MS = 1000;
const DOOR_FIRST_DELAY_MS = 500;
const DOOR_HOLD_MS = 10000;

const VIGIL_HOLD_MS = 7400;
const CROSSFADE_MS = 700;
const DOOR_CROSSFADE_MS = 900;  /* matches the door-leave CSS animation */
const PROOF_RETURN_MS = 14000;

/* The six rooms. Each is a beat in Tex's day. The summary is
   what Tex says in the vigil. The proof is what Tex says when
   the operator asks to see closer. The anchor is the small
   italic line under the proof. The hash is the actual sealed
   identifier — shown in monospace, only when the operator
   hovers the anchor. */
const ROOMS = [
  {
    key: "discovery",
    summary: {
      head: "I found eighty-three agents this week.",
      tail: "Two were new. One had gone quiet.",
    },
    proof: {
      head: "The two new ones came in through your Slack workspace on Tuesday.",
      tail:
        "The quiet one used to run on AWS Bedrock. It hasn't spoken in nine days.",
    },
    anchor: "sealed at 09:14 utc · ledger position 1,408",
    hash: "a1f3b9e7c0d4f6a82e1b5d9c3e0a7f4b6d8c2e1a9f0b3d5c7e8a4b6f1c0d2e9a3",
  },
  {
    key: "identity",
    summary: {
      head: "All of them are who they say they are.",
      tail: "One asked for more than I'd given it. I held the line.",
    },
    proof: {
      head: "The one was Kestrel.",
      tail:
        "It asked to read your finance share. Its capability surface does not include finance. I refused.",
    },
    anchor: "sealed at 11:02 utc · ledger position 1,517",
    hash: "b2e4c0f8d1a5e7b93f2c6d0a4e1b8c5d7f9a3e0b1c4d6f8a2e5b7c9d1f3a6e8b4",
  },
  {
    key: "monitoring",
    summary: {
      head: "I'm watching them all, right now. Nothing is drifting.",
      tail: "I'll tell you the moment something does.",
    },
    proof: {
      head: "The baseline for each of the eighty-three is stable.",
      tail: "The last drift event was eleven days ago. I am still watching.",
    },
    anchor: "watched continuously since 00:00 utc · 0 events",
    hash: "c3d5e7f9b1a4c6d8e0f2b5a7c9d1e3f5b7a9c2d4e6f8b0a3c5d7e9f1b4a6c8d0e",
  },
  {
    key: "execution",
    summary: {
      head: "I made 4,827 decisions today. I allowed 4,826.",
      tail: "I stopped one.",
    },
    proof: {
      head: "Kestrel tried to wire fifty thousand dollars in your CEO's name.",
      tail: "The policy says never, outside the firm. I forbade it.",
    },
    anchor: "sealed at 14:43:08 utc · evidence chain position 4,827",
    hash: "d4e6f8a0c2b5d7e9f1a3c6b8d0e2f4a7c9b1d3e5f7a9c0b2d4e6f8a1c3b5d7e9f",
  },
  {
    key: "evidence",
    summary: {
      head: "I wrote it all down.",
      tail: "If anyone ever asks, I can prove it.",
    },
    proof: {
      head: "Every decision today is linked to the one before it.",
      tail: "The chain has not been broken since I started.",
    },
    anchor: "chain intact · 38,402 records · root hash matches",
    hash: "e5f7a9c1b3d6e8f0a2c4b7d9e1f3a5c8b0d2e4f6a8c1b3d5e7f9a2c4b6d8e0f1a",
  },
  {
    key: "learning",
    summary: {
      head: "I've learned two things this week.",
      tail: "I'd like your sign-off before I use them.",
    },
    proof: {
      head: "I noticed two patterns I think we should turn into rules.",
      tail: "I will not act on them until you say yes.",
    },
    anchor: "2 proposals pending · awaiting your review",
    hash: "f6a8b0c2d4e7f9a1c3b6d8e0f2a4c7b9d1e3f5a8c0b2d4e6f8a1c3b5d7e9f0a2c",
  },
];

const DOOR_LINES = [
  "I am Tex.",
  "I see your agents.",
  "I decide what they can do.",
  "I keep the proof.",
];

export default function Vigil({ onHomeRequested }) {
  /* phase: 'door' | 'vigil' | 'proof'
     index: which room (0..5) Tex is currently on
     leaving: true while the current content is fading out */
  const [phase, setPhase] = useState("door");
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [hashVisible, setHashVisible] = useState(false);
  const [paused, setPaused] = useState(false);

  /* Timers — held in refs so we can cancel them when the operator
     interrupts or when the component unmounts. */
  const advanceTimer = useRef(null);
  const fadeTimer = useRef(null);
  const proofReturnTimer = useRef(null);

  /* The operator pressing the T mark returns to the door from
     anywhere. This is the only universal home gesture in the
     product, and it's owned by the parent. We listen for it via
     prop callback registration. */
  useEffect(() => {
    if (!onHomeRequested) return;
    onHomeRequested(() => {
      clearAll();
      setPhase("door");
      setIndex(0);
      setLeaving(false);
      setHashVisible(false);
    });
  }, [onHomeRequested]);

  /* --------------------------------------------------------------
     Pacing
     -------------------------------------------------------------- */

  const clearAll = () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    if (proofReturnTimer.current) clearTimeout(proofReturnTimer.current);
    advanceTimer.current = null;
    fadeTimer.current = null;
    proofReturnTimer.current = null;
  };

  /* Door → Vigil. After DOOR_HOLD_MS, the four lines fade out
     slowly (DOOR_CROSSFADE_MS), and the first vigil sentence
     arrives. */
  useEffect(() => {
    if (phase !== "door") return;
    if (paused) return;

    advanceTimer.current = setTimeout(() => {
      setLeaving(true);
      fadeTimer.current = setTimeout(() => {
        setPhase("vigil");
        setIndex(0);
        setLeaving(false);
      }, DOOR_CROSSFADE_MS);
    }, DOOR_HOLD_MS);

    return clearAll;
  }, [phase, paused]);

  /* Vigil pacing. Each sentence holds, then dissolves, then the
     next one arrives. After the sixth, we loop back to the first.
     Pausing freezes the cycle. */
  useEffect(() => {
    if (phase !== "vigil") return;
    if (paused) return;

    advanceTimer.current = setTimeout(() => {
      setLeaving(true);
      fadeTimer.current = setTimeout(() => {
        setIndex((i) => (i + 1) % ROOMS.length);
        setLeaving(false);
      }, CROSSFADE_MS);
    }, VIGIL_HOLD_MS);

    return clearAll;
  }, [phase, index, paused]);

  /* Proof → Vigil. After PROOF_RETURN_MS of stillness, Tex moves
     on. Not to the same room. The conversation continues. */
  useEffect(() => {
    if (phase !== "proof") return;
    if (paused) return;

    proofReturnTimer.current = setTimeout(() => {
      setLeaving(true);
      fadeTimer.current = setTimeout(() => {
        setPhase("vigil");
        setIndex((i) => (i + 1) % ROOMS.length);
        setLeaving(false);
        setHashVisible(false);
      }, CROSSFADE_MS);
    }, PROOF_RETURN_MS);

    return clearAll;
  }, [phase, paused]);

  /* --------------------------------------------------------------
     Interaction
     -------------------------------------------------------------- */

  /* Hover anywhere on the body pauses pacing. The operator gets
     to hold the sentence as long as they want. */
  const handleEnter = () => setPaused(true);
  const handleLeave = () => {
    setPaused(false);
    setHashVisible(false);
  };

  /* Click on the vigil sentence opens the proof for that room. */
  const handleSentenceClick = () => {
    if (phase !== "vigil") return;
    if (leaving) return;
    clearAll();
    setLeaving(true);
    fadeTimer.current = setTimeout(() => {
      setPhase("proof");
      setLeaving(false);
    }, CROSSFADE_MS);
  };

  /* --------------------------------------------------------------
     Render
     -------------------------------------------------------------- */

  const room = ROOMS[index];
  const stageClass = `tex-vigil-stage tex-vigil-stage--${phase}${
    leaving ? " is-leaving" : ""
  }`;

  return (
    <section
      className="tex-vigil"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {phase === "door" && (
        <div className={stageClass} key="door">
          <div className="tex-vigil-door">
            {DOOR_LINES.map((line, i) => {
              const delaySec =
                (DOOR_FIRST_DELAY_MS + i * DOOR_LINE_STAGGER_MS) / 1000;
              const durationSec = DOOR_LINE_FADE_MS / 1000;
              return (
                <p
                  key={i}
                  className="tex-vigil-door-line"
                  style={{
                    animationDelay: `${delaySec}s`,
                    animationDuration: `${durationSec}s`,
                  }}
                >
                  {line}
                </p>
              );
            })}
          </div>
        </div>
      )}

      {phase === "vigil" && (
        <div className={stageClass} key={`vigil-${index}`}>
          <button
            type="button"
            className="tex-vigil-sentence"
            onClick={handleSentenceClick}
            aria-label="Look closer at this"
          >
            <span className="tex-vigil-head">{room.summary.head}</span>{" "}
            <em className="tex-vigil-tail">{room.summary.tail}</em>
          </button>
        </div>
      )}

      {phase === "proof" && (
        <div className={stageClass} key={`proof-${index}`}>
          <div className="tex-vigil-proof">
            <p className="tex-vigil-proof-line">
              <span className="tex-vigil-head">{room.proof.head}</span>{" "}
              <em className="tex-vigil-tail">{room.proof.tail}</em>
            </p>

            <button
              type="button"
              className="tex-vigil-anchor"
              onMouseEnter={() => setHashVisible(true)}
              onMouseLeave={() => setHashVisible(false)}
              onFocus={() => setHashVisible(true)}
              onBlur={() => setHashVisible(false)}
              aria-label="Show cryptographic anchor"
            >
              {room.anchor}
            </button>

            <p
              className={`tex-vigil-hash${
                hashVisible ? " is-visible" : ""
              }`}
              aria-hidden={!hashVisible}
            >
              {room.hash}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
