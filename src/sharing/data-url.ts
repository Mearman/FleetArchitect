import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";
import { z } from "zod";
import { Fleet } from "@/schema/fleet";
import { ShipDesign } from "@/schema/ship";
import { Doctrine } from "@/schema/ai";
import { normaliseDesignInput } from "@/schema/ship-normalise";
import { parseFleetRecord } from "@/schema/fleet-normalise";
import type { TileGrid } from "@/schema/grid";
import { BattleAnomalyKind } from "@/schema/battle";
import {
  FormationLayout,
  collectTemplateRefs,
} from "@/schema/formation";
import type { Formation, FormationNode, Offset2 } from "@/schema/formation";
import { FormationTemplate } from "@/schema/formation-template";
import { decodeGrid, encodeGrid } from "@/sharing/grid-codec";

/**
 * Sharing encodes a ship design, formation template, fleet, or whole battle
 * into a compact, URL-safe string so it can be passed around in a link without
 * a server. The catalog (hulls/modules) is bundled and versioned with the app,
 * so only the entities themselves are encoded — the payload stays small.
 *
 * Version 4: formation trees round-trip losslessly. A fleet's formation tree is
 * now carried as a short-key recursive encoding (`ft`) rather than a flat ship
 * list, so nested formations AND `template` references survive a share. Every
 * template a fleet (or battle) references is bundled (`p`) and upserted by id
 * on import before the fleet itself, re-establishing the by-reference links the
 * tree carries. A standalone formation template is its own share kind. Earlier-
 * version payloads fail loudly with a `ShareDecodeError` (no dual support —
 * project convention).
 */

export const SHARE_VERSION = 4;

/**
 * A complete, self-contained battle: both fleets, every ship design and
 * formation template they reference, the anomaly and the seed. Because the
 * simulation is deterministic, these inputs replay byte-identically on any
 * machine — so encoding this is enough to share an exact scenario. `templates`
 * is the union of every template id referenced by either fleet, deduplicated;
 * the import path upserts them by id before resolve so `template` nodes inline.
 */
export const BattleShare = z.object({
  attacker: Fleet,
  defender: Fleet,
  designs: z.array(ShipDesign),
  templates: z.array(FormationTemplate),
  anomalies: z.array(BattleAnomalyKind),
  seed: z.number().int(),
});
export type BattleShare = z.infer<typeof BattleShare>;

/**
 * A fleet AND every formation template its tree references, bundled so a
 * recipient can re-establish the by-reference links before resolve. Mirrors how
 * {@link BattleShare} bundles designs: the value is self-contained — encode just
 * serialises whatever templates the caller collected.
 */
export const FleetShare = z.object({
  fleet: Fleet,
  templates: z.array(FormationTemplate),
});
export type FleetShare = z.infer<typeof FleetShare>;

export type Shareable =
  | { kind: "shipDesign"; value: ShipDesign }
  | { kind: "formationTemplate"; value: FormationTemplate }
  | { kind: "fleet"; value: FleetShare }
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
 * Fixed metadata stamped onto every decoded entity. A share carries none of
 * these persistence-only fields, so decode synthesises them; what they are does
 * not matter for replay, only that they parse and are stable. `source: "user"`
 * so imports upsert freely (never mistaken for a read-only preset).
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
 * The schema's default doctrine (no rules, empty base). Used to omit the
 * doctrine from the compact wire form when a design, fleet ship, or formation
 * carries it, keeping the common (doctrine-less) share tiny.
 */
const DEFAULT_DOCTRINE: Doctrine = Doctrine.parse({ base: {}, rules: [] });

/**
 * Whether a doctrine equals the empty default (no authored axes, no rules). The
 * compact form omits it in that case so a plain share stays small.
 */
function isDefaultDoctrine(doctrine: Doctrine): boolean {
  return (
    doctrine.rules.length === 0 &&
    Object.keys(doctrine.base).length === 0
  );
}

/**
 * The short-key form of a `ShipDesign` inside the envelope. Persistence-only
 * fields are dropped; the grid is binary; the doctrine is carried only when it
 * differs from the schema default so the common case stays tiny.
 */
const CompactDesign = z.object({
  n: z.string(),
  f: z.string(),
  b: z.string(),
  // The design's doctrine (base action + rules). Omitted when it equals the
  // empty default so a doctrine-less design round-trips compactly.
  dc: Doctrine.optional(),
});
type CompactDesign = z.infer<typeof CompactDesign>;

function compactDesign(design: ShipDesign): CompactDesign {
  const entry: CompactDesign = {
    n: design.name,
    f: design.faction,
    b: bytesToBase64Url(encodeGrid(design.grid)),
  };
  if (!isDefaultDoctrine(design.doctrine)) entry.dc = design.doctrine;
  return entry;
}

function rebuildDesign(entry: CompactDesign, index: number): ShipDesign {
  const grid: TileGrid = decodeGrid(base64UrlToBytes(entry.b));
  return ShipDesign.parse(
    normaliseDesignInput({
      id: synthDesignId(index),
      name: entry.n,
      faction: entry.f,
      grid,
      createdAt: SYNTHETIC_TIMESTAMP,
      updatedAt: SYNTHETIC_TIMESTAMP,
      source: SYNTHETIC_SOURCE,
      revision: SYNTHETIC_REVISION,
      doctrine: entry.dc ?? DEFAULT_DOCTRINE,
    }),
  );
}

// ---------------------------------------------------------------------------
// Compact projection: the recursive formation tree.
// ---------------------------------------------------------------------------

/**
 * A compact slot: `[forward, lateral]` metres — a child node's offset in its
 * parent formation's local frame. Optional and rare (the column layout ignores
 * it), so a 2-tuple is the most compact lossless encoding.
 */
const CompactSlot = z.tuple([z.number(), z.number()]);
type CompactSlot = z.infer<typeof CompactSlot>;

function compactSlot(slot: Offset2): CompactSlot {
  return [slot.forward, slot.lateral];
}

function rebuildSlot(slot: CompactSlot): Offset2 {
  return { forward: slot[0], lateral: slot[1] };
}

/**
 * The short-key shape a formation tree is carried in. The tree is encoded
 * recursively so nested formations AND `template` references survive a share
 * (the previous flat ship list lost both). Node kinds:
 *
 *  - `{ k: "S", d, x, y, fa, dc?, so? }` — a ship leaf. Reuses the design-ref
 *    shape (`d` is a small integer index into the battle's design table, or the
 *    original design id string for a standalone fleet share); `dc` is the leaf
 *    doctrine override (omitted when absent/default); `so` the optional slot.
 *  - `{ k: "T", t, so? }` — a `template` reference. `t` is the templateId
 *    (carried verbatim — the bundled templates re-establish the link by id).
 *  - `{ k: "F", fo, so? }` — a nested formation child. `fo` is the formation
 *    subtree (the same compact formation shape the fleet's root carries).
 *
 * The ROOT formation sits under the fleet's `ft` bare (no `k`/`so` wrapper — a
 * root has no slot and is always a formation, so the marker is redundant); a
 * nested formation child wraps its subtree under `fo` and carries `k: "F"` so
 * it discriminates from leaves in `c`. This mirrors `formation.ts` exactly: a
 * `Formation` is a bare recursive object, and a formation-child node wraps it.
 *
 * Doctrine and layout are omitted when they equal the schema defaults (empty
 * doctrine; `column` layout), so a lifted legacy flat root — the common case —
 * round-trips as a tiny `{ i: "root", c: [ship leaves] }`.
 */
// Recursive type aliases (hoisted) so the formation, its child wrapper, and the
// child union can reference one another. The schemas are bound with `z.lazy` +
// a `z.ZodType<T>` annotation — the documented Zod 4 recursion contract
// (mirrors `formation.ts`), not a type assertion. The discriminated-union
// members are inlined inside the lazy body so each is a concrete `ZodObject`
// (a lazy schema alone is not discriminable).
type CompactShipNode = {
  k: "S";
  d: number | string;
  x: number;
  y: number;
  fa: number;
  dc?: Doctrine;
  so?: CompactSlot;
};

type CompactTemplateNode = {
  k: "T";
  t: string;
  so?: CompactSlot;
};

type CompactFormation = {
  i: string;
  r?: string;
  fa?: number;
  l?: FormationLayout;
  dc?: Doctrine;
  c: CompactTreeNode[];
};

type CompactFormationChild = {
  k: "F";
  fo: CompactFormation;
  so?: CompactSlot;
};

type CompactTreeNode =
  | CompactShipNode
  | CompactFormationChild
  | CompactTemplateNode;

const CompactTreeNode: z.ZodType<CompactTreeNode> = z.lazy(() =>
  z.discriminatedUnion("k", [
    z.object({
      k: z.literal("S"),
      d: z.union([z.number().int(), z.string()]),
      x: z.number(),
      y: z.number(),
      fa: z.number(),
      dc: Doctrine.optional(),
      so: CompactSlot.optional(),
    }),
    z.object({
      k: z.literal("F"),
      fo: CompactFormation,
      so: CompactSlot.optional(),
    }),
    z.object({
      k: z.literal("T"),
      t: z.string(),
      so: CompactSlot.optional(),
    }),
  ]),
);

const CompactFormation: z.ZodType<CompactFormation> = z.lazy(() =>
  z.object({
    i: z.string(),
    r: z.string().optional(),
    fa: z.number().optional(),
    l: FormationLayout.optional(),
    dc: Doctrine.optional(),
    c: z.array(CompactTreeNode),
  }),
);

const CompactFleet = z.object({
  n: z.string(),
  f: z.string(),
  ft: CompactFormation,
});
type CompactFleet = z.infer<typeof CompactFleet>;

/**
 * The short-key form of a `FormationTemplate`. The id is carried verbatim
 * (`i`): templates are referenced by id from a fleet's `template` nodes, so the
 * id MUST survive a share for the by-reference link to re-establish on import
 * (unlike designs, which a battle remaps to indices). Persistence metadata is
 * dropped, as for designs.
 */
const CompactFormationTemplate = z.object({
  i: z.string(),
  n: z.string(),
  f: z.string(),
  ft: CompactFormation,
});
type CompactFormationTemplate = z.infer<typeof CompactFormationTemplate>;

/**
 * `designIndexById` remaps a ship leaf's designId to a small integer index when
 * encoding a battle (so the leaf references the design table); `undefined` for a
 * standalone fleet share, which keeps the original design id string.
 */
function compactFormation(
  formation: Formation,
  designIndexById: ReadonlyMap<string, number> | undefined,
): CompactFormation {
  const out: CompactFormation = {
    i: formation.id,
    c: formation.children.map((child) => compactNode(child, designIndexById)),
  };
  if (formation.role !== undefined) out.r = formation.role;
  if (formation.facing !== undefined) out.fa = formation.facing;
  // Absent === column (the legacy byte-identical deployment path); omit both
  // the absent and the explicit column form so a flat root stays tiny.
  if (formation.layout !== undefined && formation.layout.kind !== "column") {
    out.l = formation.layout;
  }
  if (!isDefaultDoctrine(formation.doctrine)) out.dc = formation.doctrine;
  return out;
}

/**
 * Encode a fleet's name/faction and its (recursively compact) formation tree.
 * `designIndexById` is `undefined` for a standalone fleet share (keeps the
 * original design id string) and a remap table for a battle share (indices).
 */
function compactFleet(
  fleet: Fleet,
  designIndexById: ReadonlyMap<string, number> | undefined,
): CompactFleet {
  return {
    n: fleet.name,
    f: fleet.faction,
    ft: compactFormation(fleet.formation, designIndexById),
  };
}

function compactNode(
  node: FormationNode,
  designIndexById: ReadonlyMap<string, number> | undefined,
): CompactTreeNode {
  if (node.kind === "ship") {
    const ship = node.ship;
    const index = designIndexById?.get(ship.designId);
    const designRef = index ?? ship.designId;
    const entry: CompactShipNode = {
      k: "S",
      d: designRef,
      x: ship.position.x,
      y: ship.position.y,
      fa: ship.facing,
    };
    // Carry the leaf doctrine only when authored (present and not the empty
    // default), so a doctrine-less fleet ship round-trips compactly.
    if (ship.doctrine !== undefined && !isDefaultDoctrine(ship.doctrine)) {
      entry.dc = ship.doctrine;
    }
    if (node.slot !== undefined) entry.so = compactSlot(node.slot);
    return entry;
  }
  if (node.kind === "template") {
    const entry: CompactTemplateNode = { k: "T", t: node.templateId };
    if (node.slot !== undefined) entry.so = compactSlot(node.slot);
    return entry;
  }
  // Nested formation child: wrap the encoded formation under `fo` and carry
  // its slot. The `k: "F"` marker discriminates it from ship/template leaves.
  const entry: CompactFormationChild = {
    k: "F",
    fo: compactFormation(node.formation, designIndexById),
  };
  if (node.slot !== undefined) entry.so = compactSlot(node.slot);
  return entry;
}

function compactTemplate(template: FormationTemplate): CompactFormationTemplate {
  return {
    i: template.id,
    n: template.name,
    f: template.faction,
    ft: compactFormation(template.formation, undefined),
  };
}

/**
 * Rebuild a formation as a plain (unvalidated) object; the caller passes it
 * through `parseFleetRecord` / `FormationTemplate.parse`, which recursively
 * validate the whole tree in one pass. Doctrine is omitted when absent so the
 * schema's empty-default fills it in (no masking `??`).
 */
function rebuildFormation(form: CompactFormation): unknown {
  const out: Record<string, unknown> = {
    id: form.i,
    children: form.c.map(rebuildNode),
  };
  if (form.r !== undefined) out.role = form.r;
  if (form.fa !== undefined) out.facing = form.fa;
  if (form.l !== undefined) out.layout = form.l;
  if (form.dc !== undefined) out.doctrine = form.dc;
  return out;
}

function rebuildNode(node: CompactTreeNode): unknown {
  if (node.k === "S") {
    // A battle share remaps leaf design refs to synthesised ids (d0, d1, …); a
    // standalone fleet share carries the original design id string verbatim.
    const designId =
      typeof node.d === "number" ? synthDesignId(node.d) : node.d;
    const ship: Record<string, unknown> = {
      designId,
      position: { x: node.x, y: node.y },
      facing: node.fa,
    };
    if (node.dc !== undefined) ship.doctrine = node.dc;
    const out: Record<string, unknown> = { kind: "ship", ship };
    if (node.so !== undefined) out.slot = rebuildSlot(node.so);
    return out;
  }
  if (node.k === "T") {
    const out: Record<string, unknown> = {
      kind: "template",
      templateId: node.t,
    };
    if (node.so !== undefined) out.slot = rebuildSlot(node.so);
    return out;
  }
  // Nested formation child: rebuild its subtree from the `fo` wrapper.
  const out: Record<string, unknown> = {
    kind: "formation",
    formation: rebuildFormation(node.fo),
  };
  if (node.so !== undefined) out.slot = rebuildSlot(node.so);
  return out;
}

function rebuildFleet(entry: CompactFleet): Fleet {
  // Parse through the fleet normaliser so each rebuilt leaf ship keeps its
  // round-tripped doctrine (and a legacy `orders`-carrying share, should one
  // ever appear, is compiled at the boundary). The full formation tree
  // round-trips through rebuildFormation/rebuildNode.
  return parseFleetRecord({
    id: `f-${entry.n}`,
    name: entry.n,
    faction: entry.f,
    formation: rebuildFormation(entry.ft),
    createdAt: SYNTHETIC_TIMESTAMP,
    updatedAt: SYNTHETIC_TIMESTAMP,
    source: SYNTHETIC_SOURCE,
    revision: SYNTHETIC_REVISION,
  });
}

function rebuildTemplate(entry: CompactFormationTemplate): FormationTemplate {
  return FormationTemplate.parse({
    id: entry.i,
    name: entry.n,
    faction: entry.f,
    formation: rebuildFormation(entry.ft),
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

const FormationTemplateEnvelope = z.object({
  v: z.literal(SHARE_VERSION),
  t: z.literal("formationTemplate"),
  m: CompactFormationTemplate,
});

const FleetEnvelope = z.object({
  v: z.literal(SHARE_VERSION),
  t: z.literal("fleet"),
  a: CompactFleet,
  p: z.array(CompactFormationTemplate),
});

const BattleEnvelope = z.object({
  v: z.literal(SHARE_VERSION),
  t: z.literal("battle"),
  a: CompactFleet,
  d: CompactFleet,
  g: z.array(CompactDesign),
  p: z.array(CompactFormationTemplate),
  x: z.array(BattleAnomalyKind),
  s: z.number().int(),
});

const ShareEnvelope = z.discriminatedUnion("t", [
  DesignEnvelope,
  FormationTemplateEnvelope,
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
    p: battle.templates.map(compactTemplate),
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
  } else if (shareable.kind === "formationTemplate") {
    envelope = {
      v: SHARE_VERSION,
      t: "formationTemplate",
      m: compactTemplate(shareable.value),
    };
  } else if (shareable.kind === "fleet") {
    envelope = {
      v: SHARE_VERSION,
      t: "fleet",
      a: compactFleet(shareable.value.fleet, undefined),
      p: shareable.value.templates.map(compactTemplate),
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
    if (envelope.t === "formationTemplate") {
      return {
        kind: "formationTemplate",
        value: rebuildTemplate(envelope.m),
      };
    }
    if (envelope.t === "fleet") {
      const value: FleetShare = FleetShare.parse({
        fleet: rebuildFleet(envelope.a),
        templates: envelope.p.map(rebuildTemplate),
      });
      return { kind: "fleet", value };
    }
    const value: BattleShare = BattleShare.parse({
      attacker: rebuildFleet(envelope.a),
      defender: rebuildFleet(envelope.d),
      designs: envelope.g.map((entry, index) => rebuildDesign(entry, index)),
      templates: envelope.p.map(rebuildTemplate),
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
 * The templates referenced (by id) across one or more fleets, looked up in
 * `all`, deduplicated, and closed TRANSITIVELY: a template's own subtree may
 * reference further templates (recursive composition, which `expandTemplates`
 * inlines), so each bundled template's refs are followed too. Callers that
 * construct a {@link FleetShare} or {@link BattleShare} use this so the share is
 * self-contained. Cycle-safe (a template graph cycle terminates); a referenced
 * id missing from `all` is tracked but skipped (the caller is responsible for
 * providing a complete `all`).
 */
export function referencedTemplates(
  fleets: readonly Fleet[],
  all: readonly FormationTemplate[],
): FormationTemplate[] {
  const byId = new Map<string, FormationTemplate>();
  for (const template of all) byId.set(template.id, template);
  const ordered: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    ordered.push(id);
    const template = byId.get(id);
    if (template !== undefined) {
      for (const refId of collectTemplateRefs(template.formation)) visit(refId);
    }
  };
  for (const fleet of fleets) {
    for (const id of collectTemplateRefs(fleet.formation)) visit(id);
  }
  const out: FormationTemplate[] = [];
  for (const id of ordered) {
    const template = byId.get(id);
    if (template !== undefined) out.push(template);
  }
  return out;
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
