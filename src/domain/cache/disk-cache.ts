import type * as FsPromises from "node:fs/promises";
import type * as NodePath from "node:path";
import { BattleResult } from "@/schema/battle";
import type { SimCache } from "@/domain/cache/contract";

/**
 * The node/test durable tier: completed battles persisted as `<key>.json` under
 * a directory (default `.cache/sim/`, gitignored) so a battle simulated in one
 * `pnpm test` run is reused on the next. Mirrors the IndexedDB tier for the
 * browser; this one is for the node test environment, where a real IndexedDB is
 * absent and the filesystem is the natural durable store.
 *
 * Bounded by TOTAL BYTES on disk (results are large; a byte budget caps the
 * `.cache/` footprint regardless of how many small or large results land), with
 * LRU eviction by file mtime — `get` touches the mtime on a hit, `set` evicts
 * the oldest-mtime files until the new total fits the budget.
 *
 * Node built-ins are imported LAZILY so this module can live in `src/domain/`
 * (pure boundary) and be tree-shaken out of the browser bundle: importing it
 * never pulls in `node:fs`; only constructing and using an instance does.
 */

const DEFAULT_DIR = ".cache/sim";

/** 256 MiB: a generous test-run footprint that still bounds the directory. */
export const DEFAULT_DISK_BYTES_BUDGET = 256 * 1024 * 1024;

interface NodeModules {
  readonly fs: typeof FsPromises;
  readonly path: typeof NodePath;
}

export class DiskSimCache implements SimCache {
  private modules: NodeModules | undefined;

  constructor(
    private readonly dir: string = DEFAULT_DIR,
    private readonly maxBytes: number = DEFAULT_DISK_BYTES_BUDGET,
  ) {}

  private async load(): Promise<NodeModules> {
    if (this.modules === undefined) {
      const [fs, path] = await Promise.all([
        import("node:fs/promises"),
        import("node:path"),
      ]);
      this.modules = { fs, path };
    }
    return this.modules;
  }

  private async filePath(key: string): Promise<string> {
    const { path } = await this.load();
    return path.join(this.dir, `${key}.json`);
  }

  async get(key: string): Promise<BattleResult | undefined> {
    const { fs } = await this.load();
    const file = await this.filePath(key);
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (error: unknown) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
    const json: unknown = JSON.parse(raw);
    const parsed = BattleResult.safeParse(json);
    if (!parsed.success) {
      // Shape drift: the stored result no longer matches the schema. Treat it
      // as a miss and evict the stale file so it is not re-read every lookup.
      await fs.rm(file, { force: true });
      return undefined;
    }
    // Touch mtime so this entry is most-recently used for LRU eviction.
    const now = new Date();
    await fs.utimes(file, now, now);
    return parsed.data;
  }

  async set(key: string, value: BattleResult): Promise<void> {
    const { fs } = await this.load();
    await fs.mkdir(this.dir, { recursive: true });
    const file = await this.filePath(key);
    await fs.writeFile(file, JSON.stringify(value), "utf8");
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
        .filter((name) => name.endsWith(".json"))
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
