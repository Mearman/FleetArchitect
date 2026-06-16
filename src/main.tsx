import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@/ui/theme.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { RouterProvider } from "react-router-dom";
import { mantineTheme } from "@/ui/mantine-theme";
import { router } from "@/ui/router";
import { seedPresets } from "@/storage/seed";

const rootEl = document.getElementById("root");
if (rootEl === null) {
  throw new Error("Root element #root not found");
}

const root = createRoot(rootEl);

/**
 * Seed bundled starter ships and fleets before first paint, so a new player
 * lands on a populated roster. Seeding is idempotent and fast; a failure is
 * logged but must not block the app from loading.
 */
void seedPresets()
  .catch((error) => {
    console.error("Failed to seed starter content:", error);
  })
  .finally(() => {
    root.render(
      <StrictMode>
        <MantineProvider theme={mantineTheme} defaultColorScheme="dark">
          <Notifications position="top-right" />
          <RouterProvider router={router} />
        </MantineProvider>
      </StrictMode>,
    );
  });
