import { Suspense } from "react";
import { Loader } from "@mantine/core";
import { createHashRouter, Navigate } from "react-router-dom";
import { AppLayout } from "./layout";
import { RouteErrorPage } from "./RouteErrorPage";
import {
  BattleRoute,
  FleetBuilderRoute,
  HomeRoute,
  ImportRoute,
  ShipDesignerRoute,
} from "./routeComponents";

/**
 * Hash router: GitHub Pages serves a single index.html, so client-side routes
 * must live in the hash fragment to survive a refresh without a 404. Each route
 * is wrapped in a Suspense boundary because the route components are lazy-loaded
 * (see ./routeComponents); MantineProvider mounts at the app root, so a Mantine
 * Loader is a safe fallback.
 */
export const router = createHashRouter([
  {
    path: "/",
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <Suspense fallback={<Loader />}><HomeRoute /></Suspense> },
      {
        path: "ships",
        element: <Suspense fallback={<Loader />}><ShipDesignerRoute /></Suspense>,
      },
      // The working design is encoded into the path as you edit, so the URL is
      // itself the shareable design; opening /ships/<payload> loads it.
      {
        path: "ships/:payload",
        element: <Suspense fallback={<Loader />}><ShipDesignerRoute /></Suspense>,
      },
      {
        path: "fleets",
        element: <Suspense fallback={<Loader />}><FleetBuilderRoute /></Suspense>,
      },
      { path: "battle", element: <Suspense fallback={<Loader />}><BattleRoute /></Suspense> },
      // A battle's full config (both fleets, their designs, anomaly, seed) is
      // encoded into the path so the URL itself is the shareable scenario: the
      // route writes it as you set up and replays it when opened.
      {
        path: "battle/:payload",
        element: <Suspense fallback={<Loader />}><BattleRoute /></Suspense>,
      },
      {
        path: "import/:payload",
        element: <Suspense fallback={<Loader />}><ImportRoute /></Suspense>,
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
