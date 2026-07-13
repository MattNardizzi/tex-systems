import { useEffect, useRef, useState } from "react";
import "./AccessGate.css";

/**
 * AccessGate — the quiet boundary between the public preview and the instrument.
 *
 * This remains a client-side preview gate, not an authorization boundary: Vite
 * ships VITE_ values in the browser bundle. Real access control still belongs at
 * the backend. Its job is product staging — authenticate before the day-one Tex
 * ceremony so Begin can mean exactly one thing: begin.
 */
export default function AccessGate({ passphrase, onUnlock }) {
  const [value, setValue] = useState("");
  const [wrong, setWrong] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = (event) => {
    event.preventDefault();
    if (value.trim() === passphrase) {
      setWrong(false);
      onUnlock();
      return;
    }
    setValue("");
    setWrong(true);
    inputRef.current?.focus();
  };

  return (
    <main className="tex-access">
      <section className="tex-access-threshold" aria-labelledby="tex-access-title">
        <p className="tex-access-mark">TEX</p>
        <p className="tex-access-kicker">Private preview</p>
        <h1 id="tex-access-title">Runtime governance for AI agents.</h1>
        <p className="tex-access-instruction">Enter with the preview passphrase.</p>

        <form className="tex-access-form" onSubmit={submit}>
          <label className="tex-access-label" htmlFor="tex-access-passphrase">
            Passphrase
          </label>
          <input
            ref={inputRef}
            id="tex-access-passphrase"
            className={`tex-access-input${wrong ? " is-wrong" : ""}`}
            type="password"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (wrong) setWrong(false);
            }}
            placeholder="passphrase"
            aria-invalid={wrong || undefined}
            aria-describedby={wrong ? "tex-access-error" : undefined}
            autoComplete="current-password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button className="tex-access-submit" type="submit">
            Enter Tex
          </button>
          <p
            id="tex-access-error"
            className={`tex-access-error${wrong ? " is-shown" : ""}`}
            role="status"
            aria-live="polite"
          >
            {wrong ? "That passphrase didn’t open Tex." : ""}
          </p>
        </form>
      </section>
    </main>
  );
}
