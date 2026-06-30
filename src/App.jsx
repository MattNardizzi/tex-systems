import { lazy, Suspense } from "react";
import DashboardPage from "./pages/DashboardPage";

/* DEV-ONLY design harness: ?gallery renders every surface with mock content for
   visual iteration. The lazy import is referenced ONLY behind import.meta.env.DEV,
   which Vite statically replaces with `false` in production — so the whole branch
   and its chunk are dead-code-eliminated from any prod build. */
const StyleGallery = import.meta.env.DEV
  ? lazy(() => import("./dev/StyleGallery"))
  : null;

export default function App() {
  if (
    StyleGallery &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("gallery")
  ) {
    return (
      <Suspense fallback={null}>
        <StyleGallery />
      </Suspense>
    );
  }
  return <DashboardPage />;
}
