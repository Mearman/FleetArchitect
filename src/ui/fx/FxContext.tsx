import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  FxContext,
  STORAGE_KEY,
  clampLevel,
  readPref,
  type FxLevel,
} from "./fx-internals";

export type { FxLevel } from "./fx-internals";

export function FxProvider({ children }: { children: ReactNode }) {
  const [userPref, setUserPrefState] = useState<FxLevel>(readPref);
  const [reduceMotion, setReduceMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => {
      setReduceMotion(e.matches);
    };
    mq.addEventListener("change", handler);
    return () => {
      mq.removeEventListener("change", handler);
    };
  }, []);

  const level = clampLevel(userPref, reduceMotion);

  useEffect(() => {
    document.documentElement.dataset["fx"] = level;
  }, [level]);

  const setUserPref = useCallback((next: FxLevel) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore write failures
    }
    setUserPrefState(next);
  }, []);

  return (
    <FxContext.Provider value={{ level, userPref, setUserPref }}>
      {children}
    </FxContext.Provider>
  );
}
