import { lazy, Suspense, useState } from "react";
import DashboardPage from "./pages/DashboardPage";
import AccessGate from "./components/AccessGate";

/* DEV-ONLY design harness: ?gallery renders every surface with mock content for
   visual iteration. The lazy import is referenced ONLY behind import.meta.env.DEV,
   which Vite statically replaces with `false` in production — so the whole branch
   and its chunk are dead-code-eliminated from any prod build. */
const StyleGallery = import.meta.env.DEV
  ? lazy(() => import("./dev/StyleGallery"))
  : null;

const ACCESS_SESSION_KEY = "tex:preview-access:v1";
const ACCESS_PASSPHRASE = (
  import.meta.env.VITE_TEX_BEGIN_PASSCODE || "VBTex"
).trim();

const sessionIsUnlocked = () => {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(ACCESS_SESSION_KEY) === "open";
  } catch {
    return false;
  }
};

export default function App() {
  const [unlocked, setUnlocked] = useState(sessionIsUnlocked);
  const isGallery =
    StyleGallery &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("gallery");

  if (isGallery) {
    return (
      <Suspense fallback={null}>
        <StyleGallery />
      </Suspense>
    );
  }

  if (!unlocked) {
    return (
      <AccessGate
        passphrase={ACCESS_PASSPHRASE}
        onUnlock={() => {
          try {
            window.sessionStorage.setItem(ACCESS_SESSION_KEY, "open");
          } catch {
            /* A privacy-hardened browser may decline storage; this tab still opens. */
          }
          setUnlocked(true);
        }}
      />
    );
  }

  return <DashboardPage />;
}
