import { useContext } from "react";
import { PreferencesContext, type PreferencesContextValue } from "./preferences";

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
