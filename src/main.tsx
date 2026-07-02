import "@/ui/theme/fonts";
import "@mantine/core/styles.layer.css";
import "@mantine/notifications/styles.css";
import "@/ui/theme.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { RouterProvider } from "react-router-dom";
import { mantineTheme } from "@/ui/theme/mantineTheme";
import { FxProvider } from "@/ui/fx/FxContext";
import { PreferencesProvider } from "@/ui/preferences/PreferencesContext";
import { router } from "@/ui/router";
import { seedPresets } from "@/storage/seed";

const rootEl = document.getElementById("root");
if (rootEl === null) {
  throw new Error("Root element #root not found");
}

const root = createRoot(rootEl);

// Render the shell immediately so first paint is not blocked on IndexedDB
// writes. Seeding is idempotent and runs in the background: the roster tables
// are read through Dexie live queries, which re-render the relevant routes as
// soon as the seed completes, so a new player still lands on a populated roster
// without the seed gating first paint. A failure is logged but must not block
// the app from loading.
root.render(
  <StrictMode>
    <FxProvider>
      <PreferencesProvider>
        <MantineProvider theme={mantineTheme} defaultColorScheme="dark">
          <Notifications position="top-right" />
          <RouterProvider router={router} />
        </MantineProvider>
      </PreferencesProvider>
    </FxProvider>
  </StrictMode>,
);

void seedPresets().catch((error) => {
  console.error("Failed to seed starter content:", error);
});
