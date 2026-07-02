import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);

/* The static shell (a SIBLING of #root, so crawlers and no-JS keep it) lifts
   once the app has painted beneath it — the mount is felt, not seen, instead
   of the old one-frame content swap. Nothing inside React knows it exists. */
const shell = document.getElementById("tex-static");
if (shell) {
  let lifted = false;
  const lift = () => {
    if (lifted) return;
    lifted = true;
    const drop = () => shell.remove();
    shell.addEventListener("transitionend", drop, { once: true });
    setTimeout(drop, 600); /* watchdog — the shell must never linger */
    shell.classList.add("is-lifting");
  };
  /* Paint-aligned in a visible tab (two frames = the app has painted)… */
  requestAnimationFrame(() => requestAnimationFrame(lift));
  /* …and on the clock in a HIDDEN one, where rAF never fires — a page opened
     in a background tab must not keep the shell pinned over the app. */
  setTimeout(lift, 900);
}
