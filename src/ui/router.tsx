import { createHashRouter, Navigate } from "react-router-dom";
import { AppLayout } from "./layout";
import { BattleRoute } from "./routes/BattleRoute";
import { FleetBuilderRoute } from "./routes/FleetBuilderRoute";
import { HomeRoute } from "./routes/HomeRoute";
import { ImportRoute } from "./routes/ImportRoute";
import { ShipDesignerRoute } from "./routes/ShipDesignerRoute";
import { RouteErrorPage } from "./RouteErrorPage";

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
      { index: true, element: <HomeRoute /> },
      { path: "ships", element: <ShipDesignerRoute /> },
      { path: "fleets", element: <FleetBuilderRoute /> },
      { path: "battle", element: <BattleRoute /> },
      { path: "import/:payload", element: <ImportRoute /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
