import { useEffect, useRef, useState } from "react";
import "./ProofReceipt.css";

/**
 * ProofReceipt — a stable, usable rendering of a proof handle the backend
 * actually supplied. It does not claim to verify the handle in-browser; it
 * exposes the sealed anchor intact so an operator can copy and verify it with
 * the independent tooling.
 */
export default function ProofReceipt({ value, kind = "hash", claim, onClose }) {
  const [copyState, setCopyState] = useState("idle");
  const resetTimer = useRef(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    []
  );

  if (!value) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyState("idle"), 2400);
  };

  const handleLabel = kind === "hash" ? "Sealed anchor" : "Evidence handle";
  const copyLabel =
    copyState === "copied"
      ? "Copied"
      : copyState === "failed"
      ? "Select the handle to copy"
      : "Copy handle";

  return (
    <section
      className="tex-proof-receipt"
      aria-label="Proof receipt"
      data-act="proof-receipt"
    >
      <header className="tex-proof-head">
        <span className="tex-proof-title">Proof</span>
        <span className="tex-proof-kind">{handleLabel}</span>
      </header>
      {claim && <p className="tex-proof-claim">{claim}</p>}
      <code className="tex-proof-value">{value}</code>
      <div className="tex-proof-actions">
        <button type="button" data-act="copy-proof" onClick={copy}>
          {copyLabel}
        </button>
        {onClose && (
          <button type="button" data-act="close-proof" onClick={onClose}>
            Close
          </button>
        )}
      </div>
      <span className="tex-proof-copy-status" aria-live="polite">
        {copyState === "copied"
          ? "Proof handle copied."
          : copyState === "failed"
          ? "Clipboard unavailable. Select the proof handle to copy it."
          : ""}
      </span>
    </section>
  );
}
