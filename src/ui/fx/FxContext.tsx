import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type FxLevel = "off" | "reduced" | "full";

const STORAGE_KEY = "fa-fx";
const DEFAULT_PREF: FxLevel = "full";

function clampLevel(pref: FxLevel, reduceMotion: boolean): FxLevel {
  if (!reduceMotion) return pref;
  return pref === "full" ? "reduced" : pref;
}

function readPref(): FxLevel {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "off" || stored === "reduced" || stored === "full") return stored;
  } catch {
    // localStorage unavailable in strict private browsing
  }
  return DEFAULT_PREF;
}

interface FxContextValue {
  level: FxLevel;
  userPref: FxLevel;
  setUserPref: (level: FxLevel) => void;
}

const FxContext = createContext<FxContextValue | undefined>(undefined);

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

export function useFx(): FxContextValue {
  const ctx = useContext(FxContext);
  if (ctx === undefined) {
    throw new Error("useFx must be used inside FxProvider");
  }
  return ctx;
}
