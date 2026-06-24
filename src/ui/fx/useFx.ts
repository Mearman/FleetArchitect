import { useContext } from "react";
import { FxContext, type FxContextValue } from "./fx-internals";

export function useFx(): FxContextValue {
  const ctx = useContext(FxContext);
  if (ctx === undefined) {
    throw new Error("useFx must be used inside FxProvider");
  }
  return ctx;
}
