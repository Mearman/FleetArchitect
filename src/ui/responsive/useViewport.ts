import { useMediaQuery } from "@mantine/hooks";
import { bp } from "./breakpoints";

/**
 * Returns true when the viewport is below the sm breakpoint (mobile-first).
 * Returns false on first render (SSR-safe for this client-only app).
 */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${bp.sm})`) ?? false;
}

/** Returns true when the pointer is coarse (touch device). */
export function useIsTouch(): boolean {
  return useMediaQuery("(pointer: coarse)") ?? false;
}
