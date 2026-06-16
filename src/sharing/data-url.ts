import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";
import { z } from "zod";
import { Fleet } from "@/schema/fleet";
import { ShipDesign } from "@/schema/ship";

/**
 * Sharing encodes a ship design or fleet into a compact, URL-safe string so it
 * can be passed around in a link (data URL) without a server. The catalog
 * (hulls/modules) is bundled and versioned with the app, so only the entity
 * itself is encoded — the payload stays small.
 */

export const SHARE_VERSION = 1;

const ShareEnvelope = z.object({
  v: z.literal(SHARE_VERSION),
  type: z.enum(["shipDesign", "fleet"]),
  data: z.unknown(),
});

export type Shareable =
  | { kind: "shipDesign"; value: ShipDesign }
  | { kind: "fleet"; value: Fleet };

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
