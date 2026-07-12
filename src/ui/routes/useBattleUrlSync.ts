import { useCallback, useEffect, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { notifications } from "@mantine/notifications";
import type { Fleet } from "@/schema/fleet";
import type { FormationTemplate } from "@/schema/formation-template";
import { flattenShipLeaves } from "@/schema/formation";
import type { ShipDesign } from "@/schema/ship";
import type { BattleAnomalyKind } from "@/schema/battle";
import { storage } from "@/storage/db";
import {
  ShareDecodeError,
  decodeShareable,
  encodeShareable,
  referencedTemplates,
} from "@/sharing/data-url";

/** Everything `startBattle` needs to (re)start a shared battle. */
export interface SharedBattleMatchup {
  attacker: Fleet;
  defender: Fleet;
  anomalies: BattleAnomalyKind[];
  seed: number;
  designs: ShipDesign[];
  /** Playback tick a shared link asked to open at (`?t=`), applied once the
   *  first batch resets the clock. `undefined`/0 means "start from 0". */
  initialTick?: number;
}

/** Parse the `?t=<int>` playback-tick query param, or `undefined` when absent or
 *  not a non-negative integer. Kept out of the versioned `BattleEnvelope` on
 *  purpose: the tick is recipient playback POSITION (volatile), not part of the
 *  battle definition (stable, versioned), and updating it on every scrub is
 *  cheap as a query param — no re-encode of the base64 designs blob. */
function parseTickParam(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0) return undefined;
  return n;
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
  templates: FormationTemplate[] | undefined;
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
    initialTick?: number,
  ) => void;
  autoStart: boolean;
  onSharedBattleHeld: (matchup: SharedBattleMatchup) => void;
}

/** Discrete tick-write controls returned to the route. The route calls these on
 *  scrub / pause / engage — never every animation frame, because per-tick URL
 *  writes would churn history against a fat compressed hash. */
export interface BattleUrlTickSync {
  /** Mirror `tick` into the URL's `?t=` (cleared when `tick <= 0`). Cheap: only
   *  the search string changes, the path payload is untouched. */
  writeTick: (tick: number) => void;
  /** Remove the `?t=` param (a fresh battle starts at tick 0). */
  clearTick: () => void;
}

/**
 * Keeps the battle config and the URL in sync so the address bar is itself the
 * shareable scenario — no share button. Two directions:
 *
 *  - WRITE: whenever a complete matchup is selected, the full config (both
 *    fleets, the designs they reference, anomaly and seed) is encoded into
 *    `/battle/<payload>` with replace (no history spam). The current playback
 *    tick (`?t=`, if nonzero) is carried along so a config edit does not drop
 *    it. Copy the URL to share.
 *  - READ: opening `/battle/<payload>` with a payload the app did not write
 *    itself decodes it and replays that exact battle, seeking to the `?t=`
 *    tick once the first batch lands. The decoded fleets are run transiently —
 *    never written to storage — so a pasted link stays byte-stable and never
 *    mutates the recipient's own collection.
 *
 * The tick is read ONCE when an external payload is replayed (the READ effect
 * depends on the path `payload` only), so the route's own scrub/pause tick
 * writes — which change only the search string, not the path — never re-trigger
 * an import. Refs track the app's own payload writes and the current tick so a
 * self-generated URL never re-imports.
 */
export function useBattleUrlSync({
  fleets,
  designs,
  templates,
  attackerId,
  defenderId,
  anomalies,
  seed,
  setAnomalies,
  setSeed,
  startBattle,
  autoStart,
  onSharedBattleHeld,
}: BattleUrlSyncParams): BattleUrlTickSync {
  const { payload } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const ownPayloadRef = useRef<string | null>(null);
  /** The tick currently reflected in the URL (carried forward by the WRITE
   *  effect when it re-encodes the payload). Mirrors `?t=`; 0 means "absent". */
  const tickRef = useRef(0);
  /** The tick parsed from the URL search string, mirrored into a ref so the
   *  READ effect can read it without taking `searchParams` as a dep (which would
   *  re-run the import logic on every scrub/pause tick write). */
  const urlTickRef = useRef<number | undefined>(undefined);
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

  // Mirror the URL's `?t=` into a ref (cheap; isolates the reactive search
  // string from the import effect below).
  useEffect(() => {
    urlTickRef.current = parseTickParam(searchParams.get("t"));
  }, [searchParams]);

  /** Set the `?t=<tick>` param, or clear it for `tick <= 0`. */
  const writeTick = useCallback(
    (tick: number) => {
      const safeTick = Number.isInteger(tick) && tick > 0 ? tick : 0;
      if (safeTick === tickRef.current) return;
      tickRef.current = safeTick;
      if (safeTick > 0) {
        setSearchParams({ t: String(safeTick) }, { replace: true });
      } else {
        setSearchParams({}, { replace: true });
      }
    },
    [setSearchParams],
  );
  const clearTick = useCallback(() => {
    writeTick(0);
  }, [writeTick]);

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

    const {
      attacker,
      defender,
      designs: shared,
      templates: sharedTemplates,
      anomalies: a,
      seed: s,
    } = shareable.value;
    // The tick the link asked to open at, parsed from `?t=`. Read once, at
    // replay time — the import effect runs only on a path-payload change (the
    // paste moment), so the route's own scrub/pause writes never re-trigger it.
    const initialTick = urlTickRef.current;
    if (initialTick !== undefined) tickRef.current = initialTick;
    setAnomalies(a);
    setSeed(s);
    // The decoded fleets are run transiently (never written), but a shared
    // battle's `template` nodes can only resolve against templates that live in
    // storage — `startBattle` reads them back via `loadTemplateTable`. Upsert
    // the bundled templates by id first (plain puts; replaying a link must not
    // churn the recipient's collection), then start. Preset battles bundle no
    // templates, so this is a no-op for the common preset-share case.
    void (async () => {
      for (const template of sharedTemplates) {
        await storage().formationTemplates.save(template);
      }
      if (autoStart) {
        notifications.show({
          title: "Replaying shared battle",
          message: `${attacker.name} vs ${defender.name}.`,
          color: "indigo",
        });
        startBattleRef.current(attacker, defender, a, s, shared, initialTick);
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
          initialTick,
        });
      }
    })();
  }, [payload, setAnomalies, setSeed, autoStart, onSharedBattleHeld]);

  // WRITE — mirror a complete local matchup into the URL, carrying the current
  // playback tick (`?t=`) forward so a config edit does not drop it. Runs only
  // on config changes — NOT on tick writes (those go through `writeTick`, which
  // touches only the search string and so never re-fires this encode).
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
        templates: referencedTemplates([attacker, defender], templates ?? []),
        anomalies,
        seed,
      },
    });
    const tickSuffix = tickRef.current > 0 ? `?t=${tickRef.current}` : "";
    ownPayloadRef.current = encoded;
    if (encoded !== payload) {
      void navigate(`/battle/${encoded}${tickSuffix}`, { replace: true });
    }
  }, [fleets, designs, templates, attackerId, defenderId, anomalies, seed, payload, navigate]);

  return { writeTick, clearTick };
}
