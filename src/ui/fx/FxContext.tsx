import type { ReactNode } from "react";

/**
 * Stub effects provider. Replaced in Stage 1 with the real CRT/FX context.
 */
export function FxProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
