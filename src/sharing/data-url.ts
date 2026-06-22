import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";
import { z } from "zod";
import { Fleet } from "@/schema/fleet";
import { ShipDesign } from "@/schema/ship";
import { BattleAnomaly } from "@/schema/battle";

/**
 * Sharing encodes a ship design, fleet, or whole battle into a compact, URL-safe
 * string so it can be passed around in a link without a server. The catalog
 * (hulls/modules) is bundled and versioned with the app, so only the entities
 * themselves are encoded — the payload stays small.
 *
 * Version 2: layered-cell migration (Phase 2). The grid cell model changes
 * from empty/hull/module/floor to empty/solid; v1 links fail loudly with a
 * `ShareDecodeError` (no migration). The "battle" type was added later within
 * v2 (additive — existing v2 design/fleet links keep decoding).
 */

export const SHARE_VERSION = 2;

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
  anomaly: BattleAnomaly,
  seed: z.number().int(),
});
export type BattleShare = z.infer<typeof BattleShare>;

const ShareEnvelope = z.object({
  v: z.literal(SHARE_VERSION),
  type: z.enum(["shipDesign", "fleet", "battle"]),
  data: z.unknown(),
});

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
  return "unknown error";
}

export function encodeShareable(shareable: Shareable): string {
  const envelope = {
    v: SHARE_VERSION,
    type: shareable.kind,
    data: shareable.value,
  };
  return compressToEncodedURIComponent(JSON.stringify(envelope));
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

  const envelopeResult = ShareEnvelope.safeParse(raw);
  if (!envelopeResult.success) {
    throw new ShareDecodeError("Share envelope is malformed", envelopeResult.error);
  }
  const envelope = envelopeResult.data;

  if (envelope.type === "shipDesign") {
    const result = ShipDesign.safeParse(envelope.data);
    if (!result.success) {
      throw new ShareDecodeError(
        `Ship design failed validation: ${summarise(result.error)}`,
        result.error,
      );
    }
    return { kind: "shipDesign", value: result.data };
  }

  if (envelope.type === "battle") {
    const result = BattleShare.safeParse(envelope.data);
    if (!result.success) {
      throw new ShareDecodeError(
        `Battle failed validation: ${summarise(result.error)}`,
        result.error,
      );
    }
    return { kind: "battle", value: result.data };
  }

  const result = Fleet.safeParse(envelope.data);
  if (!result.success) {
    throw new ShareDecodeError(
      `Fleet failed validation: ${summarise(result.error)}`,
      result.error,
    );
  }
  return { kind: "fleet", value: result.data };
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
