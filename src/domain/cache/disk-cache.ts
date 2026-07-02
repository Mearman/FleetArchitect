import type * as FsPromises from "node:fs/promises";
import type * as NodePath from "node:path";
import type * as NodeV8 from "node:v8";
import { isBattleResult, type BattleResult } from "@/schema/battle";
import type { SimCache } from "@/domain/cache/contract";

/**
 * The node/test durable tier: completed battles persisted as
 * `v8n<nodeMajor>-<key>.bin` under a directory (default `.cache/sim/`,
 * gitignored) so a battle simulated in one `pnpm test` run is reused on the
 * next. Mirrors the IndexedDB tier for the browser; this one is for the node
 * test environment, where a real IndexedDB is absent and the filesystem is the
 * natural durable store.
 *
 * Format: v8 structural serialisation (`node:v8`), not JSON. `BattleResult`
 * frames carry their per-cell state as typed arrays; v8 writes those as raw
 * bytes (roughly half the on-disk size of the JSON string) and deserialises
 * with a memcpy, where JSON spent most of the warm-run cost parsing. The
 * filename pins the Node major (`v8n<nodeMajor>-`) because the v8 wire format
 * is version-specific: a Node-major upgrade changes the prefix, so old files
 * are orphaned and reclaimed by the evictor rather than failing to decode.
 *
 * Bounded by TOTAL BYTES on disk, with LRU eviction by file mtime — `get`
 * touches the mtime on a hit, `set` evicts the oldest-mtime files (across both
 * the current `.bin` format and any legacy `.json` left by an earlier version)
 * until the new total fits the budget.
 *
 * Node built-ins are imported LAZILY so this module can live in `src/domain/`
 * (pure boundary) and be tree-shaken out of the browser bundle: importing it
 * never pulls in `node:fs` or `node:v8`; only constructing and using an
 * instance does.
 */

const DEFAULT_DIR = ".cache/sim";

/**
 * 2 GiB: v8 halves per-result size versus JSON (typed arrays serialise as raw
 * bytes), so 2 GiB fits the full faction-matrix working set instead of evicting
 * warm entries mid-run.
 */
export const DEFAULT_DISK_BYTES_BUDGET = 2 * 1024 * 1024 * 1024;

interface NodeModules {
  readonly fs: typeof FsPromises;
  readonly path: typeof NodePath;
  readonly v8: typeof NodeV8;
}

export class DiskSimCache implements SimCache {
  private modules: NodeModules | undefined;

  constructor(
    private readonly dir: string = DEFAULT_DIR,
    private readonly maxBytes: number = DEFAULT_DISK_BYTES_BUDGET,
  ) {}

  private async load(): Promise<NodeModules> {
    if (this.modules === undefined) {
      const [fs, path, v8] = await Promise.all([
        import("node:fs/promises"),
        import("node:path"),
        import("node:v8"),
      ]);
      this.modules = { fs, path, v8 };
    }
    return this.modules;
  }

  private async filePath(key: string): Promise<string> {
    const { path } = await this.load();
    // `process.versions.node` is a full dotted string ("26.4.0"); the major is
    // its first segment. The resulting prefix (`v8n26-`) keys the wire format:
    // a Node-major bump writes new files and leaves the old ones to the
    // evictor.
    const nodeMajor = process.versions.node.split(".")[0]!;
    return path.join(this.dir, `v8n${nodeMajor}-${key}.bin`);
  }

  async get(key: string): Promise<BattleResult | undefined> {
    const { fs, v8 } = await this.load();
    const file = await this.filePath(key);
    let buf: Buffer;
    try {
      buf = await fs.readFile(file);
    } catch (error: unknown) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
    let value: unknown;
    try {
      value = v8.deserialize(buf);
    } catch {
      // Truncated/grossly corrupt file, or a v8 wire-format mismatch (the
      // filename prefix should prevent the latter, but a half-written or
      // hand-placed file can still fail to decode). Treat it as a miss and
      // reclaim the space.
      await fs.rm(file, { force: true });
      return undefined;
    }
    if (!isBattleResult(value)) {
      // Shape drift: the stored result no longer matches the schema. Treat it
      // as a miss and evict the stale file so it is not re-read every lookup.
      // The cheap shape guard suffices here — the cache key self-invalidates on
      // schema/engine drift, so this only catches gross corruption — and avoids
      // a deep Zod traversal of the full frame graph on every warm read.
      await fs.rm(file, { force: true });
      return undefined;
    }
    // Touch mtime so this entry is most-recently used for LRU eviction.
    const now = new Date();
    await fs.utimes(file, now, now);
    return value;
  }

  async set(key: string, value: BattleResult): Promise<void> {
    const { fs, v8 } = await this.load();
    await fs.mkdir(this.dir, { recursive: true });
    const file = await this.filePath(key);
    await fs.writeFile(file, v8.serialize(value));
    await this.evict();
  }

  async has(key: string): Promise<boolean> {
    const { fs } = await this.load();
    const file = await this.filePath(key);
    try {
      await fs.access(file);
      return true;
    } catch (error: unknown) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  /** Evict oldest-mtime files until the total on-disk size fits the budget. */
  private async evict(): Promise<void> {
    const { fs, path } = await this.load();
    const names = await fs.readdir(this.dir);
    const stats = await Promise.all(
      names
        .filter((name) => name.endsWith(".bin") || name.endsWith(".json"))
        .map(async (name) => {
          const full = path.join(this.dir, name);
          const stat = await fs.stat(full);
          return { full, size: stat.size, mtimeMs: stat.mtimeMs };
        }),
    );
    let total = stats.reduce((sum, entry) => sum + entry.size, 0);
    if (total <= this.maxBytes) return;
    // Oldest first: evict until within budget.
    stats.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const entry of stats) {
      if (total <= this.maxBytes) break;
      await fs.rm(entry.full, { force: true });
      total -= entry.size;
    }
  }
}

/** Narrow an unknown caught value to the Node ENOENT (file-not-found) errno. */
function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (!("code" in error)) return false;
  return error.code === "ENOENT";
}
