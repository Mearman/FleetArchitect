import { useCallback, useState, type ReactNode } from "react";
import {
  PreferencesContext,
  STORAGE_KEY,
  readPrefs,
  type Preferences,
} from "./preferences";

export type { Preferences, PlaybackStartMode } from "./preferences";

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
