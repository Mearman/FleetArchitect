import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateLosslessBaseline } from "@/domain/simulation/lossless-configs";

/**
 * Lossless-optimisation gate. The committed `__lossless_baseline__.txt` holds the
 * per-frame SHA-256 digests of every {@link LosslessConfig} battle. An engine
 * edit is proven lossless iff regenerating the baseline against the edited engine
 * reproduces that file byte-for-byte.
 *
 * This is NOT the self-determinism check (`engine.preset-determinism`), which
 * pins that the same engine is stable across runs. This checks change-stability:
 * that an engine EDIT did not drift a single frame byte. The two are
 * complementary — self-determinism can hold while an edit silently changes every
 * frame.
 *
 * Frame bytes are NOT stable across V8 versions or CPU architectures: the engine
 * uses `sin`/`cos`/`atan2`/`hypot`/`pow`, none of which are correctly-rounded, so
 * two environments can produce different bytes for identical inputs with no code
 * change at all. The baseline is therefore environment-specific. It is stamped
 * with the `platform:arch:node<major>` that generated it:
 *  - On a matching environment the gate runs the strict byte-equality drift
 *    check (the actual lossless proof).
 *  - On any other environment a strict diff is meaningless, so the gate degrades
 *    to a self-determinism check — two independent runs on this environment are
 *    byte-identical — which is the invariant that DOES hold across environments
 *    and still surfaces a genuine in-process non-determinism regression, without
 *    false-failing on a platform difference.
 *
 * CI-excluded by default (regenerating ~60s of battles): skipped unless
 * `LOSSLESS_CHECK=1` is set. Run it locally on the canonical development
 * environment before and after an engine edit to prove losslessness. To
 * re-baseline after an intended frame change — or after adopting a new
 * environment or Node major — run with `LOSSLESS_REGENERATE=1` and commit the
 * rewritten file.
 */
const here = dirname(fileURLToPath(import.meta.url));
const baselinePath = join(here, "__lossless_baseline__.txt");

const ENV_HEADER_PREFIX = "# env: ";

/**
 * Signature of the running environment. The baseline is only comparable on the
 * environment that generated it (see file-level comment), so we stamp and
 * compare this rather than pretending one global baseline is portable.
 */
function envSignature(): string {
  const [nodeMajor] = process.versions.node.split(".");
  if (nodeMajor === undefined) {
    throw new Error(`could not parse node major from ${process.versions.node}`);
  }
  return `${process.platform}:${process.arch}:node${nodeMajor}`;
}

/** The `# env:` stamp recorded in the baseline, or `undefined` if absent. */
function readBaselineEnv(content: string): string | undefined {
  const newline = content.indexOf("\n");
  const firstLine = newline === -1 ? content : content.slice(0, newline);
  return firstLine.startsWith(ENV_HEADER_PREFIX)
    ? firstLine.slice(ENV_HEADER_PREFIX.length).trim()
    : undefined;
}

describe.skipIf(!process.env.LOSSLESS_CHECK)("lossless frame-digest baseline", () => {
  it("current engine reproduces the committed per-frame digest baseline", { timeout: 120_000 }, () => {
    const committed = readFileSync(baselinePath, "utf8");
    const current = generateLosslessBaseline();

    if (readBaselineEnv(committed) !== envSignature()) {
      // Foreign (or unrecorded) environment: frame bytes diverge by FP
      // environment, not by engine change, so a strict diff is meaningless.
      // Assert the cross-environment invariant instead — two independent runs on
      // this environment are byte-identical — which still surfaces a genuine
      // in-process non-determinism regression.
      const second = generateLosslessBaseline();
      expect(
        second,
        `baseline was generated on a different environment than this one (${envSignature()}); strict drift-check skipped, asserting self-determinism instead. Run LOSSLESS_REGENERATE=1 here to make this environment canonical.`,
      ).toBe(current);
      return;
    }

    // Home environment: strict byte-equality against the committed baseline body
    // (everything after the `# env:` header line).
    const headerLine = committed.slice(0, committed.indexOf("\n") + 1);
    const committedBody = committed.slice(headerLine.length);
    if (current !== committedBody) {
      const committedLines = committedBody.split("\n");
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
    expect(current).toBe(committedBody);
  });
});

describe.skipIf(!process.env.LOSSLESS_REGENERATE)(
  "regenerate lossless frame-digest baseline",
  () => {
    it("rewrites __lossless_baseline__.txt from the current engine", { timeout: 120_000 }, () => {
      const body = generateLosslessBaseline();
      writeFileSync(baselinePath, `${ENV_HEADER_PREFIX}${envSignature()}\n${body}`);
    });
  },
);
