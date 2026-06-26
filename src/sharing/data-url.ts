import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";
import { z } from "zod";
import { Fleet, FleetShip, Orders, defaultOrders } from "@/schema/fleet";
import { ShipDesign } from "@/schema/ship";
import { normaliseDesignInput } from "@/schema/ship-normalise";
import type { TileGrid } from "@/schema/grid";
import { BattleAnomalyKind } from "@/schema/battle";
import { flatFormation, flattenShipLeaves } from "@/schema/formation";
import { decodeGrid, encodeGrid } from "@/sharing/grid-codec";

/**
 * Sharing encodes a ship design, fleet, or whole battle into a compact, URL-safe
 * string so it can be passed around in a link without a server. The catalog
 * (hulls/modules) is bundled and versioned with the app, so only the entities
 * themselves are encoded — the payload stays small.
 *
 * Version 3: compact, fully self-contained binary share format. Each ship grid
 * is encoded with the binary grid codec (`./grid-codec`) and carried as a
 * base64url string inside a short-key JSON envelope, which is then run through
 * lz-string. Persistence-only design metadata (`createdAt`, `updatedAt`,
 * `revision`, `source`) is dropped — a share is reconstructed with synthesised
 * stable ids and fixed default metadata. Everything that affects replay (grid,
 * faction, AI posture, fleet orders, anomaly, seed) round-trips exactly, so a
 * decoded `BattleShare` replays byte-identically. Earlier-version payloads fail
 * loudly with a `ShareDecodeError` (no dual support — project convention).
 */

export const SHARE_VERSION = 3;

/**
 * A complete, self-contained battle: both fleets, every ship design they
 * reference, the anomaly and the seed. Because the simulation is deterministic,
 * these inputs replay byte-identically on any machine — so encoding this is
 * enough to share an exact scenario.
 */
export const BattleShare = z.object({
  attacker: Fleet,
  defender: Fleet,
  designs: z.array(ShipDesign),
  anomalies: z.array(BattleAnomalyKind),
  seed: z.number().int(),
});
export type BattleShare = z.infer<typeof BattleShare>;

export type Shareable =
  | { kind: "shipDesign"; value: ShipDesign }
  | { kind: "fleet"; value: Fleet }
  | { kind: "battle"; value: BattleShare };

export class ShareDecodeError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ShareDecodeError";
  }
}

function summarise(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => issue.message).join("; ");
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "unknown error";
}

/**
 * Fixed metadata stamped onto every decoded design and fleet. A share carries
 * none of these persistence-only fields, so decode synthesises them; what they
 * are does not matter for replay, only that they parse and are stable.
 */
const SYNTHETIC_TIMESTAMP = "2000-01-01T00:00:00.000Z";
const SYNTHETIC_REVISION = 1;
const SYNTHETIC_SOURCE = "user";

/** Synthesised stable id for the design at remapped index `i` (`d0`, `d1`, …). */
function synthDesignId(index: number): string {
  return `d${index}`;
}

// ---------------------------------------------------------------------------
// base64url for the binary grid payload.
// ---------------------------------------------------------------------------

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Compact projection: ShipDesign <-> short-key envelope entry.
// ---------------------------------------------------------------------------

/**
 * The short-key form of a `ShipDesign` inside the envelope. Persistence-only
 * fields are dropped; the grid is binary; AI posture is carried only when it
 * differs from the schema default so the common case stays tiny.
 */
const CompactDesign = z.object({
  n: z.string(),
  f: z.string(),
  b: z.string(),
  ss: ShipDesign.shape.shipStance.optional(),
  cp: ShipDesign.shape.crewPriority.optional(),
  r: ShipDesign.shape.rules.optional(),
});
type CompactDesign = z.infer<typeof CompactDesign>;

function compactDesign(design: ShipDesign): CompactDesign {
  const entry: CompactDesign = {
    n: design.name,
    f: design.faction,
    b: bytesToBase64Url(encodeGrid(design.grid)),
  };
  if (design.shipStance !== "balanced") entry.ss = design.shipStance;
  if (design.crewPriority !== "combat") entry.cp = design.crewPriority;
  if (design.rules.length > 0) entry.r = design.rules;
  return entry;
}

function rebuildDesign(entry: CompactDesign, index: number): ShipDesign {
  const grid: TileGrid = decodeGrid(base64UrlToBytes(entry.b));
  const candidate = {
    id: synthDesignId(index),
    name: entry.n,
    faction: entry.f,
    grid,
    createdAt: SYNTHETIC_TIMESTAMP,
    updatedAt: SYNTHETIC_TIMESTAMP,
    source: SYNTHETIC_SOURCE,
    revision: SYNTHETIC_REVISION,
    shipStance: entry.ss ?? "balanced",
    crewPriority: entry.cp ?? "combat",
    rules: entry.r ?? [],
  };
  return ShipDesign.parse(normaliseDesignInput(candidate));
}

// ---------------------------------------------------------------------------
// Compact projection: orders (omit default-valued fields).
// ---------------------------------------------------------------------------

const ORDER_KEYS: readonly (keyof Orders)[] = [
  "stance",
  "targetPriority",
  "engageRange",
  "retreatThreshold",
  "focusFire",
  "vulnerableTargetWeight",
  "formationKeeping",
  "rangeKeepingBand",
];

const PartialOrders = Orders.partial();
type PartialOrders = z.infer<typeof PartialOrders>;

function compactOrders(orders: Orders): PartialOrders {
  const out: PartialOrders = {};
  for (const key of ORDER_KEYS) {
    if (orders[key] !== defaultOrders[key]) {
      // Index-by-literal-key assignment keeps every value at its own type.
      switch (key) {
        case "stance":
          out.stance = orders.stance;
          break;
        case "targetPriority":
          out.targetPriority = orders.targetPriority;
          break;
        case "engageRange":
          out.engageRange = orders.engageRange;
          break;
        case "retreatThreshold":
          out.retreatThreshold = orders.retreatThreshold;
          break;
        case "focusFire":
          out.focusFire = orders.focusFire;
          break;
        case "vulnerableTargetWeight":
          out.vulnerableTargetWeight = orders.vulnerableTargetWeight;
          break;
        case "formationKeeping":
          out.formationKeeping = orders.formationKeeping;
          break;
        case "rangeKeepingBand":
          out.rangeKeepingBand = orders.rangeKeepingBand;
          break;
      }
    }
  }
  return out;
}

function rebuildOrders(partial: PartialOrders): Orders {
  return Orders.parse({ ...defaultOrders, ...partial });
}

// ---------------------------------------------------------------------------
// Compact projection: FleetShip and Fleet.
// ---------------------------------------------------------------------------

/**
 * Short-key fleet ship. `d` is the design reference: a small integer index into
 * the battle's design table, or — for a standalone fleet share with no design
 * table — the original design id string.
 */
const CompactFleetShip = z.object({
  d: z.union([z.number().int(), z.string()]),
  x: z.number(),
  y: z.number(),
  fa: z.number(),
  o: PartialOrders,
});
type CompactFleetShip = z.infer<typeof CompactFleetShip>;

const CompactFleet = z.object({
  n: z.string(),
  f: z.string(),
  s: z.array(CompactFleetShip),
});
type CompactFleet = z.infer<typeof CompactFleet>;

function compactFleet(
  fleet: Fleet,
  designIndexById: ReadonlyMap<string, number> | undefined,
): CompactFleet {
  return {
    n: fleet.name,
    f: fleet.faction,
    // Flatten the formation tree to its ship leaves; the compact wire form is a
    // flat ship list (a flat root formation round-trips losslessly), so the
    // shared payload stays small and a v3 URL decodes unchanged.
    s: flattenShipLeaves(fleet.formation).map((ship) => {
      const index = designIndexById?.get(ship.designId);
      const designRef = index ?? ship.designId;
      return {
        d: designRef,
        x: ship.position.x,
        y: ship.position.y,
        fa: ship.facing,
        o: compactOrders(ship.orders),
      };
    }),
  };
}

function rebuildFleetShip(entry: CompactFleetShip): FleetShip {
  const designId =
    typeof entry.d === "number" ? synthDesignId(entry.d) : entry.d;
  return FleetShip.parse({
    designId,
    position: { x: entry.x, y: entry.y },
    facing: entry.fa,
    orders: rebuildOrders(entry.o),
  });
}

function rebuildFleet(entry: CompactFleet): Fleet {
  return Fleet.parse({
    id: `f-${entry.n}`,
    name: entry.n,
    faction: entry.f,
    // Rebuild the flat ship list into a flat root formation (the deployment
    // column), matching the flattened encode above so a share round-trips.
    formation: flatFormation(entry.s.map(rebuildFleetShip)),
    createdAt: SYNTHETIC_TIMESTAMP,
    updatedAt: SYNTHETIC_TIMESTAMP,
    source: SYNTHETIC_SOURCE,
    revision: SYNTHETIC_REVISION,
  });
}

// ---------------------------------------------------------------------------
// Envelopes.
// ---------------------------------------------------------------------------

const DesignEnvelope = z.object({
  v: z.literal(SHARE_VERSION),
  t: z.literal("shipDesign"),
  g: CompactDesign,
});

const FleetEnvelope = z.object({
  v: z.literal(SHARE_VERSION),
  t: z.literal("fleet"),
  a: CompactFleet,
});

const BattleEnvelope = z.object({
  v: z.literal(SHARE_VERSION),
  t: z.literal("battle"),
  a: CompactFleet,
  d: CompactFleet,
  g: z.array(CompactDesign),
  x: z.array(BattleAnomalyKind),
  s: z.number().int(),
});

const ShareEnvelope = z.discriminatedUnion("t", [
  DesignEnvelope,
  FleetEnvelope,
  BattleEnvelope,
]);

// ---------------------------------------------------------------------------
// Encode.
// ---------------------------------------------------------------------------

function encodeBattle(battle: BattleShare): unknown {
  const designIndexById = new Map<string, number>();
  battle.designs.forEach((design, index) => {
    designIndexById.set(design.id, index);
  });
  return {
    v: SHARE_VERSION,
    t: "battle",
    a: compactFleet(battle.attacker, designIndexById),
    d: compactFleet(battle.defender, designIndexById),
    g: battle.designs.map(compactDesign),
    x: battle.anomalies,
    s: battle.seed,
  };
}

export function encodeShareable(shareable: Shareable): string {
  let envelope: unknown;
  if (shareable.kind === "shipDesign") {
    envelope = {
      v: SHARE_VERSION,
      t: "shipDesign",
      g: compactDesign(shareable.value),
    };
  } else if (shareable.kind === "fleet") {
    envelope = {
      v: SHARE_VERSION,
      t: "fleet",
      a: compactFleet(shareable.value, undefined),
    };
  } else {
    envelope = encodeBattle(shareable.value);
  }
  return compressToEncodedURIComponent(JSON.stringify(envelope));
}

// ---------------------------------------------------------------------------
// Decode.
// ---------------------------------------------------------------------------

function readVersion(raw: unknown): number {
  if (typeof raw !== "object" || raw === null || !("v" in raw)) {
    throw new ShareDecodeError("Share envelope is missing a version");
  }
  const version = raw.v;
  if (typeof version !== "number") {
    throw new ShareDecodeError("Share envelope version is not a number");
  }
  return version;
}

export function decodeShareable(encoded: string): Shareable {
  const json = decompressFromEncodedURIComponent(encoded);
  if (json === null || json.length === 0) {
    throw new ShareDecodeError("Share payload was empty or corrupt");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new ShareDecodeError("Share payload is not valid JSON", error);
  }

  const version = readVersion(raw);
  if (version !== SHARE_VERSION) {
    throw new ShareDecodeError(
      `Unsupported share version ${version}; expected ${SHARE_VERSION}`,
    );
  }

  const envelopeResult = ShareEnvelope.safeParse(raw);
  if (!envelopeResult.success) {
    throw new ShareDecodeError(
      `Share envelope is malformed: ${summarise(envelopeResult.error)}`,
      envelopeResult.error,
    );
  }
  const envelope = envelopeResult.data;

  try {
    if (envelope.t === "shipDesign") {
      return { kind: "shipDesign", value: rebuildDesign(envelope.g, 0) };
    }
    if (envelope.t === "fleet") {
      return { kind: "fleet", value: rebuildFleet(envelope.a) };
    }
    const value: BattleShare = BattleShare.parse({
      attacker: rebuildFleet(envelope.a),
      defender: rebuildFleet(envelope.d),
      designs: envelope.g.map((entry, index) => rebuildDesign(entry, index)),
      anomalies: envelope.x,
      seed: envelope.s,
    });
    return { kind: "battle", value };
  } catch (error) {
    throw new ShareDecodeError(
      `Share payload failed validation: ${summarise(error)}`,
      error,
    );
  }
}

/**
 * Build a full shareable URL with the payload in the hash. Uses the current
 * page's origin + path so it works under any GitHub Pages base path. Browser
 * only.
 */
export function buildShareUrl(encoded: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/import/${encoded}`;
}
