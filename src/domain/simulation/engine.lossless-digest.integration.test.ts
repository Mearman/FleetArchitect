import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateLosslessBaseline } from "@/domain/simulation/lossless-configs";

/**
 * Lossless-optimisation gate. The committed `__lossless_baseline__.txt` holds the
 * per-frame SHA-256 digests of every {@link LosslessConfig} battle run against
 * clean main. A Phase 2 edit is proven lossless iff regenerating the baseline
 * against the edited engine reproduces that file byte-for-byte.
 *
 * This is NOT the self-determinism check (`engine.preset-determinism`), which
 * pins that the same engine is stable across runs/platforms. This checks
 * change-stability: that an engine EDIT did not drift a single frame byte. The
 * two are complementary — self-determinism can hold while an edit silently
 * changes every frame.
 *
 * CI-excluded by default (regenerating ~60s of battles): skipped unless
 * `LOSSLESS_CHECK=1` is set. To re-baseline after an intended frame change
 * (Phase 3), run with `LOSSLESS_REGENERATE=1` to rewrite the file from the
 * current engine, then commit it alongside the algorithm-signature re-baseline.
 */
const here = dirname(fileURLToPath(import.meta.url));
const baselinePath = join(here, "__lossless_baseline__.txt");

describe.skipIf(!process.env.LOSSLESS_CHECK)("lossless frame-digest baseline", () => {
  it("current engine reproduces the committed per-frame digest baseline", { timeout: 120_000 }, () => {
    const committed = readFileSync(baselinePath, "utf8");
    const current = generateLosslessBaseline();
    if (current !== committed) {
      const committedLines = committed.split("\n");
      const currentLines = current.split("\n");
      const firstDiff = committedLines.findIndex(
        (line, index) => currentLines[index] !== line,
      );
      const was = committedLines[firstDiff] ?? "<missing>";
      const now = currentLines[firstDiff] ?? "<missing>";
      expect.fail(
        `lossless baseline diverged at line ${firstDiff} (label\\ttick):\n  was: ${was}\n  now: ${now}`,
      );
    }
    expect(current).toBe(committed);
  });
});

describe.skipIf(!process.env.LOSSLESS_REGENERATE)(
  "regenerate lossless frame-digest baseline",
  () => {
    it("rewrites __lossless_baseline__.txt from the current engine", { timeout: 120_000 }, () => {
      writeFileSync(baselinePath, generateLosslessBaseline());
    });
  },
);
