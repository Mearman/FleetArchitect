import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { notifications } from "@mantine/notifications";
import type { Fleet } from "@/schema/fleet";
import { flattenShipLeaves } from "@/schema/formation";
import type { ShipDesign } from "@/schema/ship";
import type { BattleAnomalyKind } from "@/schema/battle";
import {
  ShareDecodeError,
  decodeShareable,
  encodeShareable,
} from "@/sharing/data-url";

/** Everything `startBattle` needs to (re)start a shared battle. */
export interface SharedBattleMatchup {
  attacker: Fleet;
  defender: Fleet;
  anomalies: BattleAnomalyKind[];
  seed: number;
  designs: ShipDesign[];
}

/** The designs referenced by either fleet, deduplicated by id. */
function referencedDesigns(
  attacker: Fleet,
  defender: Fleet,
  designs: readonly ShipDesign[],
): ShipDesign[] {
  const ids = new Set<string>();
  for (const ship of [
    ...flattenShipLeaves(attacker.formation),
    ...flattenShipLeaves(defender.formation),
  ]) {
    ids.add(ship.designId);
  }
  return designs.filter((d) => ids.has(d.id));
}

interface BattleUrlSyncParams {
  fleets: Fleet[] | undefined;
  designs: ShipDesign[] | undefined;
  attackerId: string | null;
  defenderId: string | null;
  anomalies: BattleAnomalyKind[];
  seed: number;
  setAnomalies: (anomalies: BattleAnomalyKind[]) => void;
  setSeed: (seed: number) => void;
  startBattle: (
    attacker: Fleet,
    defender: Fleet,
    anomalies: BattleAnomalyKind[],
    seed: number,
    designs: ShipDesign[],
  ) => void;
  autoStart: boolean;
  onSharedBattleHeld: (matchup: SharedBattleMatchup) => void;
}

/**
 * Keeps the battle config and the URL in sync so the address bar is itself the
 * shareable scenario — no share button. Two directions:
 *
 *  - WRITE: whenever a complete matchup is selected, the full config (both
 *    fleets, the designs they reference, anomaly and seed) is encoded into
 *    `/battle/<payload>` with replace (no history spam). Copy the URL to share.
 *  - READ: opening `/battle/<payload>` with a payload the app did not write
 *    itself decodes it and replays that exact battle. The decoded fleets are run
 *    transiently — never written to storage — so a pasted link stays
 *    byte-stable and never mutates the recipient's own collection.
 *
 * Refs track the app's own writes and the links already imported, so a
 * self-generated URL never re-imports and each shared link replays once.
 */
export function useBattleUrlSync({
  fleets,
  designs,
  attackerId,
  defenderId,
  anomalies,
  seed,
  setAnomalies,
  setSeed,
  startBattle,
  autoStart,
  onSharedBattleHeld,
}: BattleUrlSyncParams): void {
  const { payload } = useParams();
  const navigate = useNavigate();
  const ownPayloadRef = useRef<string | null>(null);
  // Hold the latest startBattle in a ref so the import effect depends only on
  // `payload` (a stable value), not the recreated-each-render callback. This
  // also survives StrictMode's setup -> cleanup -> setup: the run the first
  // setup starts is aborted by the simulation's cleanup, and the second setup
  // re-issues it (a persistent "import once" guard would skip that re-issue,
  // leaving the battle aborted and never restarted).
  const startBattleRef = useRef(startBattle);
  useEffect(() => {
    startBattleRef.current = startBattle;
  });

  // READ — replay an externally-supplied battle URL. Skips the app's own URL
  // writes (ownPayloadRef); runs when an external/pasted payload appears.
  useEffect(() => {
    if (payload === undefined) return;
    if (payload === ownPayloadRef.current) return;

    let shareable;
    try {
      shareable = decodeShareable(payload);
    } catch (error) {
      notifications.show({
        title: "Couldn't read battle link",
        message:
          error instanceof ShareDecodeError
            ? error.message
            : "The link is malformed.",
        color: "red",
      });
      return;
    }
    if (shareable.kind !== "battle") return;

    const { attacker, defender, designs: shared, anomalies: a, seed: s } =
      shareable.value;
    setAnomalies(a);
    setSeed(s);
    if (autoStart) {
      notifications.show({
        title: "Replaying shared battle",
        message: `${attacker.name} vs ${defender.name}.`,
        color: "indigo",
      });
      startBattleRef.current(attacker, defender, a, s, shared);
    } else {
      notifications.show({
        title: "Shared battle loaded",
        message: `${attacker.name} vs ${defender.name} — press Start.`,
        color: "indigo",
      });
      onSharedBattleHeld({
        attacker,
        defender,
        anomalies: a,
        seed: s,
        designs: shared,
      });
    }
  }, [payload, setAnomalies, setSeed, autoStart, onSharedBattleHeld]);

  // WRITE — mirror a complete local matchup into the URL.
  useEffect(() => {
    if (fleets === undefined || designs === undefined) return;
    if (attackerId === null || defenderId === null) return;
    const attacker = fleets.find((f) => f.id === attackerId);
    const defender = fleets.find((f) => f.id === defenderId);
    if (attacker === undefined || defender === undefined) return;

    const encoded = encodeShareable({
      kind: "battle",
      value: {
        attacker,
        defender,
        designs: referencedDesigns(attacker, defender, designs),
        anomalies,
        seed,
      },
    });
    ownPayloadRef.current = encoded;
    if (encoded !== payload) {
      void navigate(`/battle/${encoded}`, { replace: true });
    }
  }, [fleets, designs, attackerId, defenderId, anomalies, seed, payload, navigate]);
}
