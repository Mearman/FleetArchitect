/**
 * The non-component parts of the preferences context: the Zod schema + inferred
 * types, the localStorage reader, the context value type, and the context
 * object itself. Kept in a module with NO component export so
 * `react-refresh/only-export-components` (which fires only when a file mixes
 * component and non-component exports) is satisfied — the Provider lives in
 * `PreferencesContext.tsx`, the hook in `usePreferences.ts`, and both import
 * the shared schema/context from here.
 */

import { createContext } from "react";
import { z } from "zod";

/**
 * User-controllable preferences governing battle-simulation behaviour. Every
 * field carries a `.default()` so a stale or partially-stored object always
 * yields a complete value after parsing.
 */
export const Preferences = z.object({
  /** Whether computation begins automatically when the battle route mounts. */
  autoStartComputationOnLoad: z.boolean().default(true),
  /** Whether playback starts automatically (subject to `playbackStartMode`). */
  autoStartPlayback: z.boolean().default(true),
  /** When auto-playback triggers: as soon as the buffer is ready, or only once the full computation finishes. */
  playbackStartMode: z.enum(["whenBuffered", "onComplete"]).default("whenBuffered"),
});
export type Preferences = z.infer<typeof Preferences>;
export type PlaybackStartMode = z.infer<typeof Preferences.shape.playbackStartMode>;

const STORAGE_KEY = "fa-preferences";

/**
 * Read and validate the persisted preferences object. A missing, malformed, or
 * partially-stored value always resolves to a complete `Preferences` object via
 * `Preferences.parse({})`, which applies every field's `.default()`.
 *
 * `localStorage` may throw in strict private-browsing mode; the catch falls
 * back to defaults so the provider always has a usable value on first render.
 */
export function readPrefs(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      const result = Preferences.safeParse(parsed);
      if (result.success) return result.data;
    }
  } catch {
    // localStorage unavailable in strict private browsing
  }
  return Preferences.parse({});
}

export interface PreferencesContextValue {
  preferences: Preferences;
  setPreferences: (next: Preferences) => void;
}

export const PreferencesContext = createContext<PreferencesContextValue | undefined>(
  undefined,
);

export { STORAGE_KEY };
