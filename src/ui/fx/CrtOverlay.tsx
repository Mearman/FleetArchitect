import { useEffect } from "react";
import { useFx } from "./FxContext";
import { overlay, vignette, bootRoot } from "./CrtOverlay.css";

/**
 * CRT effects overlay — renders scanlines and a curvature vignette on top of
 * the entire app. Pointer-events: none ensures it never captures clicks. The
 * boot animation and RGB shift are gated on html[data-fx="full"] in CSS.
 */
export function CrtOverlay() {
  const { level } = useFx();

  useEffect(() => {
    const root = document.getElementById("root");
    if (root === null) return;
    root.classList.add(bootRoot);
    return () => {
      root.classList.remove(bootRoot);
    };
  }, []);

  if (level === "off") return null;

  return (
    <>
      <div className={overlay} aria-hidden="true" />
      <div className={vignette} aria-hidden="true" />
    </>
  );
}
