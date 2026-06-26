import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { notifications } from "@mantine/notifications";
import type { ShipDesign } from "@/schema/ship";
import { nowIso } from "@/domain/id";
import {
  ShareDecodeError,
  decodeShareable,
  encodeShareable,
} from "@/sharing/data-url";
import { fitGridCentered } from "./designerGrid";
import type { WorkingDesign } from "./designerConstants";

/** Debounce so a paint stroke doesn't re-encode the whole design every cell. */
const WRITE_DEBOUNCE_MS = 400;

/** Build a ShipDesign for encoding. The grid is cropped to its built content so
 *  the URL stays compact and stable regardless of the editor's viewport-fill
 *  padding (which the recipient re-applies on load anyway). */
function workingToDesign(working: WorkingDesign): ShipDesign {
  const { grid } = fitGridCentered(working.grid, 1, 1);
  return {
    id: working.id ?? "draft",
    name: working.name || "Untitled",
    faction: working.faction || "Unaligned",
    grid,
    createdAt: working.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    source: working.source,
    revision: 1,
    shipStance: working.shipStance,
    crewPriority: working.crewPriority,
    rules: working.rules,
  };
}

/**
 * Keeps the ship design and the URL in sync so the address bar is itself the
 * shareable design — like `useBattleUrlSync` for the designer. Two directions:
 *
 *  - WRITE: whenever the working design changes, it is encoded (debounced) into
 *    `/ships/<payload>` with replace (no history spam).
 *  - READ: opening `/ships/<payload>` with a payload the app did not write
 *    itself decodes it and loads that design into the editor.
 *
 * `ownPayloadRef` tracks the app's own writes so a self-generated URL never
 * re-imports; `onLoadRef` holds the latest loader so the read effect depends
 * only on the (stable) payload.
 */
export function useShipDesignUrlSync(
  working: WorkingDesign,
  onLoad: (design: ShipDesign) => void,
): void {
  const { payload } = useParams();
  const navigate = useNavigate();
  const ownPayloadRef = useRef<string | null>(null);
  const onLoadRef = useRef(onLoad);
  useEffect(() => {
    onLoadRef.current = onLoad;
  });

  // READ — load an externally-supplied ship URL (skip the app's own writes).
  useEffect(() => {
    if (payload === undefined) return;
    if (payload === ownPayloadRef.current) return;
    let shareable;
    try {
      shareable = decodeShareable(payload);
    } catch (error) {
      notifications.show({
        title: "Couldn't read ship link",
        message:
          error instanceof ShareDecodeError
            ? error.message
            : "The link is malformed.",
        color: "red",
      });
      return;
    }
    if (shareable.kind !== "shipDesign") return;
    notifications.show({
      title: "Opened shared ship",
      message: shareable.value.name,
      color: "indigo",
    });
    onLoadRef.current(shareable.value);
  }, [payload]);

  // WRITE — mirror the working design into the URL, debounced.
  useEffect(() => {
    const handle = setTimeout(() => {
      const encoded = encodeShareable({
        kind: "shipDesign",
        value: workingToDesign(working),
      });
      ownPayloadRef.current = encoded;
      if (encoded !== payload) {
        void navigate(`/ships/${encoded}`, { replace: true });
      }
    }, WRITE_DEBOUNCE_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [working, payload, navigate]);
}
