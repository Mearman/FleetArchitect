/**
 * Unit tests for {@link stationNeedsCrew}.
 *
 * `stationNeedsCrew` gates which module kinds the crew dispatcher treats as
 * stations worth chasing: a kind returning `true` is one whose `crewRequired`
 * gates its output, so crew are sent to man it; a kind returning `false` is
 * passive (pure structure or a bay with no manning-gated output). The launcher
 * kinds (mineLayer, decoy, hangar, boarding) were previously excluded, which
 * left crew never dispatched to man them — their launch functions all gate on
 * `isOperational` (which requires `manned`), so they never fired on any ship.
 * These tests pin the corrected classification so a regression that moves a
 * launch-gated kind back into the `false` branch fails loudly.
 */

import { describe, expect, it } from "vitest";
import type { ModuleEffect } from "@/schema/module";

import { stationNeedsCrew } from "./crew";

/** Every module effect kind the schema defines, in schema declaration order. */
const ALL_KINDS: readonly ModuleEffect["kind"][] = [
  "weapon",
  "shield",
  "deflector",
  "engine",
  "power",
  "crew",
  "pointDefense",
  "repair",
  "hull",
  "magazine",
  "sensor",
  "comms",
  "rcs",
  "reactionWheel",
  "blink",
  "afterburner",
  "overcharge",
  "cloak",
  "signature",
  "ecm",
  "eccm",
  "decoy",
  "commandAura",
  "hangar",
  "mineLayer",
  "boarding",
];

/** Kinds whose output is gated on `manned` — crew must be dispatched to them. */
const CREW_STATION_KINDS = new Set<ModuleEffect["kind"]>([
  "weapon",
  "engine",
  "shield",
  "deflector",
  "pointDefense",
  "power",
  "magazine",
  "sensor",
  "comms",
  // Launchers: their launch functions (layMines, launchDecoys, launchDrones,
  // launchPods) gate on isOperational → manned, so a crewRequired > 0 launcher
  // is a real crew station.
  "mineLayer",
  "decoy",
  "hangar",
  "boarding",
]);

describe("stationNeedsCrew", () => {
  it("returns true for every launch-gated kind (mineLayer, decoy, hangar, boarding)", () => {
    const launchKinds: ModuleEffect["kind"][] = ["mineLayer", "decoy", "hangar", "boarding"];
    for (const kind of launchKinds) {
      expect(stationNeedsCrew(kind), `${kind} should need crew`).toBe(true);
    }
  });

  it("returns true for the core combat stations (weapon, engine, shield, power)", () => {
    const coreKinds: ModuleEffect["kind"][] = ["weapon", "engine", "shield", "power"];
    for (const kind of coreKinds) {
      expect(stationNeedsCrew(kind), `${kind} should need crew`).toBe(true);
    }
  });

  it("returns true for crewed sensors and comms (manning gates their contribution)", () => {
    expect(stationNeedsCrew("sensor")).toBe(true);
    expect(stationNeedsCrew("comms")).toBe(true);
  });

  it("returns false for passive structure and non-station bays", () => {
    // hull is pure structure; crew/repair quarters carry no manning-gated output
    // of their own; rcs/reactionWheel are passive manoeuvring gear.
    const passiveKinds: ModuleEffect["kind"][] = ["hull", "crew", "repair", "rcs", "reactionWheel"];
    for (const kind of passiveKinds) {
      expect(stationNeedsCrew(kind), `${kind} should not need crew`).toBe(false);
    }
  });

  it("the launch-gated kinds are in the crew-station set (regression guard)", () => {
    // Direct pin: the four launcher kinds that were once wrongly excluded.
    expect(stationNeedsCrew("mineLayer")).toBe(true);
    expect(stationNeedsCrew("decoy")).toBe(true);
    expect(stationNeedsCrew("hangar")).toBe(true);
    expect(stationNeedsCrew("boarding")).toBe(true);
  });

  it("every schema kind resolves to its expected branch (exhaustive)", () => {
    // The switch must be exhaustive over ModuleEffect["kind"]. TS enforces this
    // at compile time; this test guards the classification itself: each kind's
    // result matches the CREW_STATION_KINDS table above, so adding a new kind
    // without deciding its branch (and adding it here) fails the test.
    for (const kind of ALL_KINDS) {
      const expected = CREW_STATION_KINDS.has(kind);
      expect(stationNeedsCrew(kind), `${kind} expected ${expected}`).toBe(expected);
    }
  });
});
