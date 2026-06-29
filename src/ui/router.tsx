import { Suspense, lazy } from "react";
import { Loader } from "@mantine/core";
import { createHashRouter, Navigate } from "react-router-dom";
import { AppLayout } from "./layout";
import { RouteErrorPage } from "./RouteErrorPage";

/**
 * Route-level code splitting. Each route loads on demand via React.lazy so the
 * heavy Battle route — the canvas renderer, every overlay, the battle worker,
 * the sim cache + Dexie tiers, and the catalog's eager Zod parse — stays out of
 * the initial bundle for a user who lands on Home and never opens a battle.
 * MantineProvider mounts at the app root (src/main.tsx), so a Mantine Loader is
 * a safe Suspense fallback here.
 */
const HomeRoute = lazy(() => import("./routes/HomeRoute").then((m) => ({ default: m.HomeRoute })));
const ShipDesignerRoute = lazy(() =>
  import("./routes/ShipDesignerRoute").then((m) => ({ default: m.ShipDesignerRoute })),
);
const FleetBuilderRoute = lazy(() =>
  import("./routes/FleetBuilderRoute").then((m) => ({ default: m.FleetBuilderRoute })),
);
const BattleRoute = lazy(() => import("./routes/BattleRoute").then((m) => ({ default: m.BattleRoute })));
const ImportRoute = lazy(() => import("./routes/ImportRoute").then((m) => ({ default: m.ImportRoute })));

const routeFallback = <Loader />;

/**
 * Hash router: GitHub Pages serves a single index.html, so client-side routes
 * must live in the hash fragment to survive a refresh without a 404.
 */
export const router = createHashRouter([
  {
    path: "/",
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <Suspense fallback={routeFallback}><HomeRoute /></Suspense> },
      { path: "ships", element: <Suspense fallback={routeFallback}><ShipDesignerRoute /></Suspense> },
      // The working design is encoded into the path as you edit, so the URL is
      // itself the shareable design; opening /ships/<payload> loads it.
      {
        path: "ships/:payload",
        element: <Suspense fallback={routeFallback}><ShipDesignerRoute /></Suspense>,
      },
      { path: "fleets", element: <Suspense fallback={routeFallback}><FleetBuilderRoute /></Suspense> },
      { path: "battle", element: <Suspense fallback={routeFallback}><BattleRoute /></Suspense> },
      // A battle's full config (both fleets, their designs, anomaly, seed) is
      // encoded into the path so the URL itself is the shareable scenario: the
      // route writes it as you set up and replays it when opened.
      { path: "battle/:payload", element: <Suspense fallback={routeFallback}><BattleRoute /></Suspense> },
      { path: "import/:payload", element: <Suspense fallback={routeFallback}><ImportRoute /></Suspense> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
