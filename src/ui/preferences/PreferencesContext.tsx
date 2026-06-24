import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
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
export type PlaybackStartMode = z.infer<
  typeof Preferences.shape.playbackStartMode
>;

const STORAGE_KEY = "fa-preferences";

/**
 * Read and validate the persisted preferences object. A missing, malformed, or
 * partially-stored value always resolves to a complete `Preferences` object via
 * `Preferences.parse({})`, which applies every field's `.default()`.
 *
 * `localStorage` may throw in strict private-browsing mode; the catch falls
 * back to defaults so the provider always has a usable value on first render.
 */
function readPrefs(): Preferences {
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

interface PreferencesContextValue {
  preferences: Preferences;
  setPreferences: (next: Preferences) => void;
}

const PreferencesContext = createContext<PreferencesContextValue | undefined>(
  undefined,
);

/**
 * Provides preference state to the React tree. Reads synchronously from
 * `localStorage` in the `useState` initializer so that consumers (e.g. the
 * battle route's URL-sync auto-start effect) see the persisted value on the
 * very first render, before any effects fire.
 */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferencesState] = useState<Preferences>(readPrefs);

  const setPreferences = useCallback((next: Preferences) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore write failures (private mode, quota)
    }
    setPreferencesState(next);
  }, []);

  return (
    <PreferencesContext.Provider value={{ preferences, setPreferences }}>
      {children}
    </PreferencesContext.Provider>
  );
}

/**
 * Access the current preferences and setter. Must be called inside a
 * `PreferencesProvider`; throws otherwise.
 */
export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (ctx === undefined) {
    throw new Error("usePreferences must be used inside PreferencesProvider");
  }
  return ctx;
}
