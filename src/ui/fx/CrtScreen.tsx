import { useFx } from "./FxContext";
import { overlay, vignette } from "./CrtOverlay.css";

/**
 * CRT screen effects confined to a single display surface. Renders the scanline
 * overlay (with flicker and chromatic aberration at the full level) and a
 * curvature vignette, both absolutely positioned to fill the nearest
 * position:relative ancestor. Place it inside a display container (the battle
 * canvas box, or a non-scrolling wrapper over the designer viewport) so the
 * effects land on the screen rather than across the whole app. Pointer-events:
 * none keeps it from capturing clicks; it renders nothing when effects are off.
 */
export function CrtScreen() {
  const { level } = useFx();
  if (level === "off") return null;

  return (
    <>
      <div className={overlay} aria-hidden="true" />
      <div className={vignette} aria-hidden="true" />
    </>
  );
}
