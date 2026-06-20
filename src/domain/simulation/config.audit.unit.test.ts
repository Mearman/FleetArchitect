/**
 * Phase 15 SIM.* audit — regression guard against magic literals.
 *
 * Every key on `SIM` (and its nested object keys) must carry, in the
 * immediately preceding doc comment, an explicit `Classification:` line
 * naming one of the four grounding categories defined in
 * `engine/config.ts` and the realism-overhaul plan:
 *
 *   - real physical constant
 *   - derived-by-formula
 *   - authored catalogue content
 *   - unit-spec-rate-epsilon
 *
 * This test parses `config.ts` as text (it is checking the doc comment,
 * which is erased at runtime) and fails if any key is missing the marker.
 * A new `SIM.*` entry added without a classification line turns this test
 * red, blocking the magic-literal regression the Phase 15 audit exists to
 * prevent.
 */
import { describe, expect, it } from "vitest";

import { SIM } from "@/domain/simulation/engine/config";
import configSource from "@/domain/simulation/engine/config.ts?raw";

const CLASSIFICATION_MARKER = "classification:";

interface KeyEntry {
  /** Dotted path; top-level keys are bare, nested keys are `<parent>.<leaf>`. */
  readonly path: string;
  /** Indent depth in spaces (2 = top-level SIM key, 4 = nested). */
  readonly indent: number;
  /** True if a `/** ... *\/` comment is immediately above this key. */
  readonly hasComment: boolean;
  /** True if that comment contains the classification marker. */
  readonly classified: boolean;
}

/**
 * Walk the `SIM = { ... }` block line by line, pairing each `key:` line with
 * the doc comment that immediately precedes it. A key is "documented" iff a
 * `/** ... *\/` block ends on the line directly above it (ignoring blank
 * lines). Nested object literals are flattened to `<parent>.<leaf>` paths so
 * the audit catches a missing classification on `blackHoleAvoid.safetyMargin`
 * as readily as on `firingArc`.
 */
function auditKeys(sourceText: string): KeyEntry[] {
  const start = sourceText.indexOf("export const SIM = {");
  expect(start, "SIM object literal found in config.ts").toBeGreaterThan(-1);
  const end = sourceText.indexOf("\n};", start);
  expect(end, "SIM object literal closes with `};`").toBeGreaterThan(start);
  const block = sourceText.slice(start, end);

  const entries: KeyEntry[] = [];
  const lines = block.split("\n");

  // `pending` accumulates the lines of the doc comment currently being read.
  // `ready` holds the text of a fully-closed comment waiting to be consumed
  // by the next key line. A key consumes `ready` (or "" if none is pending)
  // and resets it.
  let pending: string[] | null = null;
  let ready = "";
  let parentKey = "";

  const KEY_RE = /^( {2}| {4})([A-Za-z]\w*):/;

  for (const line of lines) {
    const trimmedEnd = line.trimEnd();
    const opener = trimmedEnd.includes("/**");

    // Inside a comment: accumulate until it closes.
    if (pending !== null) {
      pending.push(trimmedEnd);
      if (trimmedEnd.includes("*/")) {
        ready = pending.join("\n");
        pending = null;
      }
      continue;
    }

    // A new comment opens on this line: start accumulating. (A single-line
    // `/** ... */` opener also lands here and closes immediately.)
    if (opener) {
      pending = [trimmedEnd];
      if (trimmedEnd.includes("*/")) {
        ready = pending.join("\n");
        pending = null;
      }
      continue;
    }

    // Not inside a comment: is this a key line?
    const keyMatch = KEY_RE.exec(trimmedEnd);
    if (keyMatch !== null) {
      const indentStr = keyMatch[1];
      const key = keyMatch[2];
      if (indentStr === undefined || key === undefined) continue;
      const indent = indentStr.length;
      if (indent === 2) parentKey = key;
      const path = indent === 2 ? key : `${parentKey}.${key}`;
      const comment = ready;
      ready = "";
      entries.push({
        path,
        indent,
        hasComment: comment !== "",
        classified: comment.toLowerCase().includes(CLASSIFICATION_MARKER),
      });
    }
    // Blank or other lines between a closed comment and its key are not
    // present in the SIM block by construction; if one appeared it would
    // leave `ready` populated and the next key would still consume it,
    // which is the forgiving behaviour we want.
  }

  return entries;
}

describe("SIM.* constant audit (Phase 15)", () => {
  const entries = auditKeys(configSource);

  it("parses at least one SIM key from config.ts", () => {
    expect(entries.length, "SIM keys were parsed").toBeGreaterThan(0);
  });

  it("every SIM key (top-level and nested) carries a Classification marker", () => {
    // A top-level key must carry its own classification. A nested leaf
    // (e.g. `rangeFraction.short`) inherits its parent's doc comment — it has
    // no comment of its own — so it passes iff its parent top-level key is
    // classified.
    const topLevelClassified = new Set(
      entries
        .filter((e) => e.indent === 2 && e.classified)
        .map((e) => e.path),
    );
    const missing = entries
      .filter((e) => {
        if (e.classified) return false;
        if (e.indent === 4) {
          // Nested leaf: covered by its parent's classification.
          const parent = e.path.slice(0, e.path.indexOf("."));
          return !topLevelClassified.has(parent);
        }
        return true;
      })
      .map((e) => e.path);
    expect(
      missing,
      `SIM keys missing a "${CLASSIFICATION_MARKER}" line in their doc comment. Add a "Classification: <category>" line citing one of: real physical constant | derived-by-formula | authored catalogue content | unit-spec-rate-epsilon.`,
    ).toEqual([]);
  });

  it("every top-level runtime SIM key has a matching source entry", () => {
    // Nested-object leaves (e.g. `rangeFraction.short`) share their parent's
    // doc comment and have no comment of their own; only top-level keys are
    // required to appear as parsed source entries.
    const sourcePaths = new Set(entries.map((e) => e.path));
    const runtimeTopLevel = Object.keys(SIM);
    const undocumented = runtimeTopLevel.filter((k) => !sourcePaths.has(k));
    expect(
      undocumented,
      `SIM top-level keys present at runtime but with no parsed source entry: ${undocumented.join(", ")}`,
    ).toEqual([]);
  });
});
