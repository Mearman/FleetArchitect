import { modules } from "@/data/catalog";
import {
  ALL_OPEN_EDGES,
  CellEdges,
  type CellEquipment,
  type Connection,
  type DoorState,
  type EdgeKind,
  type GridCell,
  type HardwireResource,
  type SurfaceKind,
  TileGrid,
} from "@/schema/grid";

/**
 * Compact binary codec for a `TileGrid`. The on-disk JSON of a ship grid is
 * dominated by redundancy: a row-major array of per-cell objects where the
 * overwhelming majority are plain solid interior cells with all-open edges.
 * This codec writes the same information as a dense bit/byte stream so a shared
 * battle URL shrinks by roughly twenty times once lz-string runs on top.
 *
 * Round-trip is exact: `decodeGrid(encodeGrid(g))` deep-equals `g` after the
 * grid has been through `TileGrid.parse` (schema normalisation — omitted
 * `edges` refilled to `ALL_OPEN_EDGES`, defaults applied). Equipment numerics
 * are written as IEEE-754 float64, never quantised, so byte-identical replay is
 * preserved.
 *
 * Binary layout (all multi-byte integers are unsigned LEB128 varints; bits are
 * packed LSB-first within each byte):
 *   1.  codec-version byte (currently `CODEC_VERSION`).
 *   2.  varint `cols`, varint `rows`.
 *   3.  occupancy bitmap: one bit per cell in row-major order
 *       (index `row * cols + col`), set = solid, clear = empty;
 *       `ceil(cols * rows / 8)` bytes.
 *   4.  2-bit surface stream over the SOLID cells in row-major order
 *       (`bare` = 0, `deck` = 1, `armor` = 2), packed.
 *   5.  specials: varint count, then for each solid cell that has non-all-open
 *       edges OR equipment, in row-major order:
 *         - varint cellIndex (row-major),
 *         - 1 flag byte (bit0 `hasEdges`, bit1 `hasEquipment`),
 *         - if `hasEdges`: 1 byte packing 4 edges x 2 bits
 *           (`open` = 0, `wall` = 1, `door` = 2) in n,e,s,w order, then a
 *           door-state bit (`open` = 0, `closed` = 1) for each edge whose kind
 *           is `door`, in n,e,s,w order, packed,
 *         - if `hasEquipment`: an equipment block.
 *   7.  equipment block (starts with a 1-byte tag):
 *         - tag `0` (anchor): varint moduleCatalogIndex (index into the
 *           bundled module catalog), float64 `facing`, 1 presence byte for
 *           the five optional fields (bit0 `channel`, bit1 `commsBearing`,
 *           bit2 `commsRange`, bit3 `sensorBearing`, bit4 `sensorRangeSetting`),
 *           followed by each present value in that order: `channel` as a
 *           varint integer; the other four as float64.
 *         - tag `1` (covered cell of a multi-cell module): varint
 *           moduleCatalogIndex (the anchor module's id), varint `anchorCol`,
 *           varint `anchorRow`. A covered cell carries no per-instance config
 *           of its own; it inherits the anchor's identity.
 *   8.  connections: varint count, then per connection varint `from.col`,
 *       `from.row`, `to.col`, `to.row`, and 2 bits `resource`
 *       (`ammo` = 0, `power` = 1, `manning` = 2).
 */

const CODEC_VERSION = 2;

/** Per-axis ceiling on a decoded grid's dimensions. The largest authored ship is
 *  well under 100 cells on a side, so 1000 is a generous margin (a 1000x1000
 *  grid is ~1e6 cells, a few MB — safe) while bounding `cols`/`rows` read from
 *  an attacker-controlled share before any allocation loop runs. Without it a
 *  crafted payload declaring cols=rows=1e9 forces a 1e18-entry allocation. */
const MAX_GRID_DIMENSION = 1000;

const SURFACE_TO_CODE: Record<SurfaceKind, number> = {
  bare: 0,
  deck: 1,
  armor: 2,
};
const CODE_TO_SURFACE: readonly SurfaceKind[] = ["bare", "deck", "armor"];

const EDGE_TO_CODE: Record<EdgeKind, number> = {
  open: 0,
  wall: 1,
  door: 2,
};
const CODE_TO_EDGE: readonly EdgeKind[] = ["open", "wall", "door"];

const DOOR_TO_CODE: Record<DoorState, number> = {
  open: 0,
  closed: 1,
};
const CODE_TO_DOOR: readonly DoorState[] = ["open", "closed"];

const RESOURCE_TO_CODE: Record<HardwireResource, number> = {
  ammo: 0,
  power: 1,
  manning: 2,
};
const CODE_TO_RESOURCE: readonly HardwireResource[] = ["ammo", "power", "manning"];

const DIRECTIONS: readonly ("n" | "e" | "s" | "w")[] = ["n", "e", "s", "w"];

const FLAG_HAS_EDGES = 1;
const FLAG_HAS_EQUIPMENT = 2;

const EQUIP_CHANNEL = 1;
const EQUIP_COMMS_BEARING = 2;
const EQUIP_COMMS_RANGE = 4;
const EQUIP_SENSOR_BEARING = 8;
const EQUIP_SENSOR_RANGE = 16;
/** Equipment presence bit 5: multi-cell anchor has a non-canonical rotation. */
const EQUIP_ROTATION = 32;

/** Equipment block tag: discriminates an anchor (moduleId present, current
 *  shape) from a covered cell of a multi-cell module (covers back-pointer). */
const EQUIP_TAG_ANCHOR = 0;
const EQUIP_TAG_COVERED = 1;

/** Stable mapping from module id to its index in the bundled catalog order. */
const MODULE_ID_TO_INDEX: Map<string, number> = new Map(
  modules.map((mod, index) => [mod.id, index]),
);

// ---------------------------------------------------------------------------
// Byte stream writer / reader.
// ---------------------------------------------------------------------------

/**
 * Append-only byte stream with LEB128 varints, float64 via `DataView`, and
 * LSB-first bit packing. Bits are buffered into a partial byte that is flushed
 * when full or when a byte/varint/float write begins, so the bit and byte
 * streams stay aligned to byte boundaries.
 */
class ByteWriter {
  private bytes: number[] = [];
  private bitBuffer = 0;
  private bitCount = 0;

  private flushBits(): void {
    if (this.bitCount > 0) {
      this.bytes.push(this.bitBuffer);
      this.bitBuffer = 0;
      this.bitCount = 0;
    }
  }

  byte(value: number): void {
    this.flushBits();
    this.bytes.push(value & 0xff);
  }

  varint(value: number): void {
    this.flushBits();
    let remaining = value;
    while (remaining >= 0x80) {
      this.bytes.push((remaining & 0x7f) | 0x80);
      remaining = Math.floor(remaining / 128);
    }
    this.bytes.push(remaining & 0x7f);
  }

  float64(value: number): void {
    this.flushBits();
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value);
    for (let i = 0; i < 8; i += 1) {
      this.bytes.push(view.getUint8(i));
    }
  }

  bit(value: number): void {
    this.bitBuffer |= (value & 1) << this.bitCount;
    this.bitCount += 1;
    if (this.bitCount === 8) {
      this.bytes.push(this.bitBuffer);
      this.bitBuffer = 0;
      this.bitCount = 0;
    }
  }

  /** Write `count` low bits of `value`, LSB first. */
  bits(value: number, count: number): void {
    for (let i = 0; i < count; i += 1) {
      this.bit((value >> i) & 1);
    }
  }

  finish(): Uint8Array {
    this.flushBits();
    return Uint8Array.from(this.bytes);
  }
}

/** Mirror of `ByteWriter`: reads in the exact order the writer wrote. */
class ByteReader {
  private offset = 0;
  private bitByte = 0;
  private bitCount = 0;

  constructor(private readonly bytes: Uint8Array) {}

  private alignToByte(): void {
    this.bitCount = 0;
  }

  private nextByte(): number {
    if (this.offset >= this.bytes.length) {
      throw new Error("grid codec: unexpected end of stream");
    }
    const value = this.bytes[this.offset];
    if (value === undefined) {
      throw new Error("grid codec: unexpected end of stream");
    }
    this.offset += 1;
    return value;
  }

  byte(): number {
    this.alignToByte();
    return this.nextByte();
  }

  varint(): number {
    this.alignToByte();
    let result = 0;
    let multiplier = 1;
    for (;;) {
      const group = this.nextByte();
      result += (group & 0x7f) * multiplier;
      if ((group & 0x80) === 0) break;
      multiplier *= 128;
    }
    return result;
  }

  float64(): number {
    this.alignToByte();
    const view = new DataView(new ArrayBuffer(8));
    for (let i = 0; i < 8; i += 1) {
      view.setUint8(i, this.nextByte());
    }
    return view.getFloat64(0);
  }

  bit(): number {
    if (this.bitCount === 0) {
      this.bitByte = this.nextByte();
      this.bitCount = 8;
    }
    const value = this.bitByte & 1;
    this.bitByte >>= 1;
    this.bitCount -= 1;
    return value;
  }

  /** Read `count` bits, LSB first, into an integer. */
  bits(count: number): number {
    let result = 0;
    for (let i = 0; i < count; i += 1) {
      result |= this.bit() << i;
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Cell helpers.
// ---------------------------------------------------------------------------

/** A solid cell narrowed from the discriminated union. */
type SolidCell = Extract<GridCell, { kind: "solid" }>;

function isSolid(cell: GridCell): cell is SolidCell {
  return cell.kind === "solid";
}

function edgesNeedSpecial(edges: CellEdges): boolean {
  if (edges.n !== "open" || edges.e !== "open") return true;
  if (edges.s !== "open" || edges.w !== "open") return true;
  const { doorStates } = edges;
  return (
    doorStates.n !== undefined ||
    doorStates.e !== undefined ||
    doorStates.s !== undefined ||
    doorStates.w !== undefined
  );
}

// ---------------------------------------------------------------------------
// Encode.
// ---------------------------------------------------------------------------

function writeEdges(writer: ByteWriter, edges: CellEdges): void {
  let packed = 0;
  for (let i = 0; i < DIRECTIONS.length; i += 1) {
    const dir = DIRECTIONS[i];
    if (dir === undefined) continue;
    packed |= EDGE_TO_CODE[edges[dir]] << (i * 2);
  }
  writer.byte(packed);
  for (const dir of DIRECTIONS) {
    if (edges[dir] !== "door") continue;
    const state = edges.doorStates[dir];
    if (state === undefined) {
      throw new Error("grid codec: door edge missing door state");
    }
    writer.bit(DOOR_TO_CODE[state]);
  }
}

function writeEquipment(writer: ByteWriter, equipment: CellEquipment): void {
  // Covered cell of a multi-cell module: write the covers back-pointer.
  if (equipment.moduleId === undefined) {
    if (equipment.covers === undefined) {
      // The CellEquipment refine guarantees exactly one of moduleId/covers is
      // set; unreachable for parsed input but guard for runtime safety.
      throw new Error("grid codec: equipment carries neither moduleId nor covers");
    }
    const index = MODULE_ID_TO_INDEX.get(equipment.covers.moduleId);
    if (index === undefined) {
      throw new Error(
        `grid codec: covers module '${equipment.covers.moduleId}' is not in the catalog`,
      );
    }
    writer.byte(EQUIP_TAG_COVERED);
    writer.varint(index);
    writer.varint(equipment.covers.anchorCol);
    writer.varint(equipment.covers.anchorRow);
    return;
  }
  // Anchor: the existing shape, prefixed with the anchor tag.
  writer.byte(EQUIP_TAG_ANCHOR);
  const index = MODULE_ID_TO_INDEX.get(equipment.moduleId);
  if (index === undefined) {
    throw new Error(
      `grid codec: equipment module '${equipment.moduleId}' is not in the catalog`,
    );
  }
  writer.varint(index);
  writer.float64(equipment.facing);

  let presence = 0;
  if (equipment.channel !== undefined) presence |= EQUIP_CHANNEL;
  if (equipment.commsBearing !== undefined) presence |= EQUIP_COMMS_BEARING;
  if (equipment.commsRange !== undefined) presence |= EQUIP_COMMS_RANGE;
  if (equipment.sensorBearing !== undefined) presence |= EQUIP_SENSOR_BEARING;
  if (equipment.sensorRangeSetting !== undefined) presence |= EQUIP_SENSOR_RANGE;
  if (equipment.rotation !== undefined && equipment.rotation > 0) presence |= EQUIP_ROTATION;
  writer.byte(presence);

  if (equipment.channel !== undefined) writer.varint(equipment.channel);
  if (equipment.commsBearing !== undefined) writer.float64(equipment.commsBearing);
  if (equipment.commsRange !== undefined) writer.float64(equipment.commsRange);
  if (equipment.sensorBearing !== undefined) writer.float64(equipment.sensorBearing);
  if (equipment.sensorRangeSetting !== undefined) {
    writer.float64(equipment.sensorRangeSetting);
  }
  if (equipment.rotation !== undefined && equipment.rotation > 0) writer.byte(equipment.rotation);
}

/** Encode a parsed `TileGrid` to a compact, deterministic byte buffer. */
export function encodeGrid(grid: TileGrid): Uint8Array {
  const writer = new ByteWriter();
  writer.byte(CODEC_VERSION);
  writer.varint(grid.cols);
  writer.varint(grid.rows);

  // Occupancy bitmap, one bit per cell row-major.
  for (const cell of grid.cells) {
    writer.bit(isSolid(cell) ? 1 : 0);
  }

  // Surface stream over solid cells, 2 bits each.
  for (const cell of grid.cells) {
    if (isSolid(cell)) {
      writer.bits(SURFACE_TO_CODE[cell.surface], 2);
    }
  }

  // Specials: solid cells with non-all-open edges or equipment.
  const specials: { index: number; cell: SolidCell }[] = [];
  for (let index = 0; index < grid.cells.length; index += 1) {
    const cell = grid.cells[index];
    if (cell === undefined || !isSolid(cell)) continue;
    const hasEdges = edgesNeedSpecial(cell.edges);
    const hasEquipment = cell.equipment !== undefined;
    if (hasEdges || hasEquipment) {
      specials.push({ index, cell });
    }
  }
  writer.varint(specials.length);
  for (const { index, cell } of specials) {
    writer.varint(index);
    const hasEdges = edgesNeedSpecial(cell.edges);
    const hasEquipment = cell.equipment !== undefined;
    let flags = 0;
    if (hasEdges) flags |= FLAG_HAS_EDGES;
    if (hasEquipment) flags |= FLAG_HAS_EQUIPMENT;
    writer.byte(flags);
    if (hasEdges) writeEdges(writer, cell.edges);
    if (hasEquipment && cell.equipment !== undefined) {
      writeEquipment(writer, cell.equipment);
    }
  }

  // Connections.
  writer.varint(grid.connections.length);
  for (const conn of grid.connections) {
    writer.varint(conn.from.col);
    writer.varint(conn.from.row);
    writer.varint(conn.to.col);
    writer.varint(conn.to.row);
    writer.bits(RESOURCE_TO_CODE[conn.resource], 2);
  }

  return writer.finish();
}

// ---------------------------------------------------------------------------
// Decode.
// ---------------------------------------------------------------------------

function codeToSurface(code: number): SurfaceKind {
  const surface = CODE_TO_SURFACE[code];
  if (surface === undefined) {
    throw new Error(`grid codec: invalid surface code ${code}`);
  }
  return surface;
}

function codeToEdge(code: number): EdgeKind {
  const edge = CODE_TO_EDGE[code];
  if (edge === undefined) {
    throw new Error(`grid codec: invalid edge code ${code}`);
  }
  return edge;
}

function codeToDoor(code: number): DoorState {
  const door = CODE_TO_DOOR[code];
  if (door === undefined) {
    throw new Error(`grid codec: invalid door code ${code}`);
  }
  return door;
}

function codeToResource(code: number): HardwireResource {
  const resource = CODE_TO_RESOURCE[code];
  if (resource === undefined) {
    throw new Error(`grid codec: invalid resource code ${code}`);
  }
  return resource;
}

function readEdges(reader: ByteReader): CellEdges {
  const packed = reader.byte();
  const kinds: Record<"n" | "e" | "s" | "w", EdgeKind> = {
    n: codeToEdge((packed >> 0) & 0b11),
    e: codeToEdge((packed >> 2) & 0b11),
    s: codeToEdge((packed >> 4) & 0b11),
    w: codeToEdge((packed >> 6) & 0b11),
  };
  const doorStates: {
    n?: DoorState;
    e?: DoorState;
    s?: DoorState;
    w?: DoorState;
  } = {};
  for (const dir of DIRECTIONS) {
    if (kinds[dir] === "door") {
      doorStates[dir] = codeToDoor(reader.bit());
    }
  }
  return CellEdges.parse({
    n: kinds.n,
    e: kinds.e,
    s: kinds.s,
    w: kinds.w,
    doorStates,
  });
}

function readEquipment(reader: ByteReader): CellEquipment {
  const tag = reader.byte();
  if (tag === EQUIP_TAG_COVERED) {
    const moduleIndex = reader.varint();
    const mod = modules[moduleIndex];
    if (mod === undefined) {
      throw new Error(`grid codec: invalid module catalog index ${moduleIndex}`);
    }
    const anchorCol = reader.varint();
    const anchorRow = reader.varint();
    return { facing: 0, covers: { moduleId: mod.id, anchorCol, anchorRow } };
  }
  if (tag !== EQUIP_TAG_ANCHOR) {
    throw new Error(`grid codec: invalid equipment tag ${tag}`);
  }
  const moduleIndex = reader.varint();
  const mod = modules[moduleIndex];
  if (mod === undefined) {
    throw new Error(`grid codec: invalid module catalog index ${moduleIndex}`);
  }
  const facing = reader.float64();
  const presence = reader.byte();

  const equipment: CellEquipment = { moduleId: mod.id, facing };
  if ((presence & EQUIP_CHANNEL) !== 0) equipment.channel = reader.varint();
  if ((presence & EQUIP_COMMS_BEARING) !== 0) equipment.commsBearing = reader.float64();
  if ((presence & EQUIP_COMMS_RANGE) !== 0) equipment.commsRange = reader.float64();
  if ((presence & EQUIP_SENSOR_BEARING) !== 0) {
    equipment.sensorBearing = reader.float64();
  }
  if ((presence & EQUIP_SENSOR_RANGE) !== 0) {
    equipment.sensorRangeSetting = reader.float64();
  }
  if ((presence & EQUIP_ROTATION) !== 0) equipment.rotation = reader.byte();
  return equipment;
}

/** Decode a buffer produced by `encodeGrid` back into a parsed `TileGrid`. */
export function decodeGrid(bytes: Uint8Array): TileGrid {
  const reader = new ByteReader(bytes);
  const version = reader.byte();
  if (version !== CODEC_VERSION) {
    throw new Error(`grid codec: unsupported codec version ${version}`);
  }
  const cols = reader.varint();
  const rows = reader.varint();
  if (cols > MAX_GRID_DIMENSION || rows > MAX_GRID_DIMENSION) {
    throw new Error(
      `grid codec: grid dimensions ${cols}x${rows} exceed the ${MAX_GRID_DIMENSION}-cell limit`,
    );
  }
  const cellCount = cols * rows;

  // Occupancy bitmap.
  const solidFlags: boolean[] = [];
  for (let i = 0; i < cellCount; i += 1) {
    solidFlags.push(reader.bit() === 1);
  }

  // Surface stream over solid cells.
  const surfaces: SurfaceKind[] = [];
  for (let i = 0; i < cellCount; i += 1) {
    if (solidFlags[i]) {
      surfaces.push(codeToSurface(reader.bits(2)));
    }
  }

  // Specials keyed by cell index.
  const specialEdges = new Map<number, CellEdges>();
  const specialEquipment = new Map<number, CellEquipment>();
  const specialCount = reader.varint();
  for (let s = 0; s < specialCount; s += 1) {
    const index = reader.varint();
    const flags = reader.byte();
    if ((flags & FLAG_HAS_EDGES) !== 0) {
      specialEdges.set(index, readEdges(reader));
    }
    if ((flags & FLAG_HAS_EQUIPMENT) !== 0) {
      specialEquipment.set(index, readEquipment(reader));
    }
  }

  // Rebuild cells in row-major order.
  let solidCursor = 0;
  const cells: GridCell[] = [];
  for (let i = 0; i < cellCount; i += 1) {
    if (!solidFlags[i]) {
      cells.push({ kind: "empty" });
      continue;
    }
    const surface = surfaces[solidCursor];
    solidCursor += 1;
    if (surface === undefined) {
      throw new Error("grid codec: surface stream underran the solid cells");
    }
    const edges = specialEdges.get(i) ?? ALL_OPEN_EDGES;
    const equipment = specialEquipment.get(i);
    const cell: SolidCell = equipment
      ? { kind: "solid", substrate: true, surface, edges, equipment }
      : { kind: "solid", substrate: true, surface, edges };
    cells.push(cell);
  }

  // Connections.
  const connections: Connection[] = [];
  const connectionCount = reader.varint();
  for (let c = 0; c < connectionCount; c += 1) {
    const fromCol = reader.varint();
    const fromRow = reader.varint();
    const toCol = reader.varint();
    const toRow = reader.varint();
    const resource = codeToResource(reader.bits(2));
    connections.push({
      from: { col: fromCol, row: fromRow },
      to: { col: toCol, row: toRow },
      resource,
    });
  }

  return TileGrid.parse({
    cols,
    rows,
    cells,
    connections,
  });
}
