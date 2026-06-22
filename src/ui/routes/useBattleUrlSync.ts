import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { notifications } from "@mantine/notifications";
import type { Fleet } from "@/schema/fleet";
import type { ShipDesign } from "@/schema/ship";
import type { BattleAnomaly } from "@/schema/battle";
import {
  ShareDecodeError,
  decodeShareable,
  encodeShareable,
} from "@/sharing/data-url";

/** The designs referenced by either fleet, deduplicated by id. */
function referencedDesigns(
  attacker: Fleet,
  defender: Fleet,
  designs: readonly ShipDesign[],
): ShipDesign[] {
  const ids = new Set<string>();
  for (const ship of [...attacker.ships, ...defender.ships]) {
    ids.add(ship.designId);
  }
  return designs.filter((d) => ids.has(d.id));
}

interface BattleUrlSyncParams {
  fleets: Fleet[] | undefined;
  designs: ShipDesign[] | undefined;
  attackerId: string | null;
  defenderId: string | null;
  anomaly: BattleAnomaly;
  seed: number;
  setAnomaly: (anomaly: BattleAnomaly) => void;
  setSeed: (seed: number) => void;
  startBattle: (
    attacker: Fleet,
    defender: Fleet,
    anomaly: BattleAnomaly,
    seed: number,
    designs: ShipDesign[],
  ) => void;
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
  anomaly,
  seed,
  setAnomaly,
  setSeed,
  startBattle,
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

    const { attacker, defender, designs: shared, anomaly: a, seed: s } =
      shareable.value;
    setAnomaly(a);
    setSeed(s);
    notifications.show({
      title: "Replaying shared battle",
      message: `${attacker.name} vs ${defender.name}.`,
      color: "indigo",
    });
    startBattleRef.current(attacker, defender, a, s, shared);
  }, [payload, setAnomaly, setSeed]);

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
        anomaly,
        seed,
      },
    });
    ownPayloadRef.current = encoded;
    if (encoded !== payload) {
      navigate(`/battle/${encoded}`, { replace: true });
    }
  }, [fleets, designs, attackerId, defenderId, anomaly, seed, payload, navigate]);
}
