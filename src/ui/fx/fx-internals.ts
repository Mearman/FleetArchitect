/**
 * The non-component parts of the FX context: the context object, its value
 * type, the preference level type, and the localStorage helpers. Kept in a
 * module with NO component export so `react-refresh/only-export-components`
 * (which fires only when a file mixes component and non-component exports) is
 * satisfied — the Provider component lives in `FxContext.tsx`, the hook in
 * `useFx.ts`, and both import the shared context object from here.
 */

import { createContext } from "react";

export type FxLevel = "off" | "reduced" | "full";

export const STORAGE_KEY = "fa-fx";
export const DEFAULT_PREF: FxLevel = "full";

export function clampLevel(pref: FxLevel, reduceMotion: boolean): FxLevel {
  if (!reduceMotion) return pref;
  return pref === "full" ? "reduced" : pref;
}

export function readPref(): FxLevel {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "off" || stored === "reduced" || stored === "full") return stored;
  } catch {
    // localStorage unavailable in strict private browsing
  }
  return DEFAULT_PREF;
}

export interface FxContextValue {
  level: FxLevel;
  userPref: FxLevel;
  setUserPref: (level: FxLevel) => void;
}

export const FxContext = createContext<FxContextValue | undefined>(undefined);
