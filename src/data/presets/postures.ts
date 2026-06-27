import type { DoctrineAction } from "@/schema/ai";

/**
 * Named posture verbs — the high-level behavioural presets a player slaps onto
 * a formation (or a ship) before fine-tuning the individual doctrine axes. Each
 * preset populates the {@link DoctrineAction} axes (stance, spatial objective,
 * targeting, fire discipline, crew priority, cohesion, retreat) with sensible
 * values for that posture; selecting one in the doctrine editor fills the axes,
 * which the player then edits freely.
 *
 * These are authoring sugar over the raw axes — they carry no semantics the
 * engine reads directly. The engine consumes only the resulting
 * {@link DoctrineAction}; a preset is just a pre-filled starting point. Every
 * preset is documented so the editor can surface a one-line intent tooltip.
 *
 * Spatial objectives reference the {@link FormationReference} kinds the engine
 * resolves at evaluation time. Most presets anchor movement to the enemy
 * (`target`), the ship's own formation (`self` — interpreted as the formation
 * centroid at resolve), or the side's deployment line (`deployment`). The
 * bearing/range pair encodes the verb's geometry: "pursue" closes range with a
 * free bearing; "orbit" sweeps bearing at a held range; "screen" stations at a
 * fixed offset ahead of the reference.
 */

/** A posture preset: its display label, intent, and the action it fills. */
export interface PosturePreset {
  /** The verb key (stable identifier; never shown raw). */
  key: PostureKey;
  /** British English display label, e.g. "Escort". */
  label: string;
  /** One-line intent description, shown as a tooltip in the doctrine editor. */
  intent: string;
  /** The doctrine action this preset populates. */
  action: DoctrineAction;
}

/** A posture verb key — the discriminator of {@link PosturePreset}. */
export type PostureKey =
  | "escort"
  | "screen"
  | "pursue"
  | "intercept"
  | "orbit"
  | "flee"
  | "kite"
  | "defend"
  | "reserve"
  | "strike";

/** The canonical posture verb keys, in display order. */
export const POSTURE_KEYS: readonly PostureKey[] = [
  "escort",
  "screen",
  "pursue",
  "intercept",
  "orbit",
  "flee",
  "kite",
  "defend",
  "reserve",
  "strike",
];

/** The posture keys as a plain string set, for O(1) narrowing without a cast. */
const POSTURE_KEY_SET: ReadonlySet<string> = new Set(POSTURE_KEYS);

/** Type predicate: narrows a string to a valid posture key without a cast. */
export function isPostureKey(value: string): value is PostureKey {
  return POSTURE_KEY_SET.has(value);
}

/** The preset table, keyed by verb. Order matches {@link POSTURE_KEYS}. */
export const POSTURE_PRESETS: Record<PostureKey, PosturePreset> = {
  escort: {
    key: "escort",
    label: "Escort",
    intent:
      "Stay close to the friendly formation centroid and shoot what threatens it.",
    action: {
      stance: "escort",
      spatial: {
        reference: { kind: "self" },
        range: { kind: "hold", band: 0.2 },
        bearing: { kind: "free" },
      },
      targeting: {
        mode: { kind: "threatsTo", reference: { kind: "self" } },
        vulnerableWeight: 0.2,
        focusFire: true,
      },
      fire: "atWill",
      crew: "combat",
      cohesion: 0.8,
      retreat: 0.25,
    },
  },
  screen: {
    key: "screen",
    label: "Screen",
    intent:
      "Hold a defensive line ahead of the friendly body; engage incoming threats.",
    action: {
      stance: "defensive",
      spatial: {
        reference: { kind: "self" },
        range: { kind: "hold", band: 0.25 },
        bearing: { kind: "offset", frame: "fleet", angle: 0 },
      },
      targeting: {
        mode: { kind: "threatsTo", reference: { kind: "self" } },
        vulnerableWeight: 0.1,
        focusFire: true,
      },
      fire: "atWill",
      crew: "combat",
      cohesion: 0.6,
      retreat: 0.3,
    },
  },
  pursue: {
    key: "pursue",
    label: "Pursue",
    intent: "Close on the current target and press the attack.",
    action: {
      stance: "aggressive",
      spatial: {
        reference: { kind: "target" },
        range: { kind: "close" },
        bearing: { kind: "toward", reference: { kind: "target" } },
      },
      targeting: {
        mode: { kind: "nearest" },
        vulnerableWeight: 0.3,
        focusFire: true,
      },
      fire: "atWill",
      crew: "combat",
      cohesion: 0.4,
      retreat: 0.1,
    },
  },
  intercept: {
    key: "intercept",
    label: "Intercept",
    intent:
      "Dash onto an incoming enemy formation and break it up at close range.",
    action: {
      stance: "interceptor",
      spatial: {
        reference: { kind: "enemy", role: "vanguard" },
        range: { kind: "close" },
        bearing: { kind: "toward", reference: { kind: "enemy", role: "vanguard" } },
      },
      targeting: {
        mode: { kind: "membersOf", reference: { kind: "enemy", role: "vanguard" } },
        vulnerableWeight: 0.4,
        focusFire: true,
      },
      fire: "atWill",
      crew: "combat",
      cohesion: 0.3,
      retreat: 0.15,
    },
  },
  orbit: {
    key: "orbit",
    label: "Orbit",
    intent: "Circle the target at a held range, sweeping fire around it.",
    action: {
      stance: "balanced",
      spatial: {
        reference: { kind: "target" },
        range: { kind: "engage", fraction: 0.6, tolerance: 0.1 },
        bearing: { kind: "orbit", omega: 0.02, phase: 0 },
      },
      targeting: {
        mode: { kind: "nearest" },
        vulnerableWeight: 0.2,
        focusFire: false,
      },
      fire: "atWill",
      crew: "combat",
      cohesion: 0.2,
      retreat: 0.2,
    },
  },
  flee: {
    key: "flee",
    label: "Flee",
    intent: "Break contact — open range and disengage from the enemy.",
    action: {
      stance: "evasive",
      spatial: {
        reference: { kind: "target" },
        range: { kind: "evade", minRange: 8000 },
        bearing: { kind: "away", reference: { kind: "target" } },
      },
      targeting: {
        mode: { kind: "none" },
        vulnerableWeight: 0,
        focusFire: false,
      },
      fire: "holdFire",
      crew: "damageControl",
      cohesion: 0.5,
      retreat: 0.5,
    },
  },
  kite: {
    key: "kite",
    label: "Kite",
    intent: "Stand off at maximum weapon range and wear the target down.",
    action: {
      stance: "sniper",
      spatial: {
        reference: { kind: "target" },
        range: { kind: "kite", maxRange: 30000 },
        bearing: { kind: "free" },
      },
      targeting: {
        mode: { kind: "weakest" },
        vulnerableWeight: 0.5,
        focusFire: true,
      },
      fire: "atWill",
      crew: "combat",
      cohesion: 0.3,
      retreat: 0.35,
    },
  },
  defend: {
    key: "defend",
    label: "Defend",
    intent:
      "Hold ground at the deployment line; prioritise the strongest threat.",
    action: {
      stance: "defensive",
      spatial: {
        reference: { kind: "deployment" },
        range: { kind: "hold", band: 0.3 },
        bearing: { kind: "free" },
      },
      targeting: {
        mode: { kind: "strongest" },
        vulnerableWeight: 0.2,
        focusFire: true,
      },
      fire: "atWill",
      crew: "combat",
      cohesion: 0.7,
      retreat: 0.2,
    },
  },
  reserve: {
    key: "reserve",
    label: "Reserve",
    intent:
      "Loiter at the deployment line and commit only once the enemy is engaged.",
    action: {
      stance: "balanced",
      spatial: {
        reference: { kind: "deployment" },
        range: { kind: "hold", band: 0.4 },
        bearing: { kind: "free" },
      },
      targeting: {
        mode: { kind: "highestCost" },
        vulnerableWeight: 0.3,
        focusFire: true,
      },
      fire: "whenFiredUpon",
      crew: "damageControl",
      cohesion: 0.6,
      retreat: 0.15,
    },
  },
  strike: {
    key: "strike",
    label: "Strike",
    intent:
      "Concentrate fire on the most valuable target; press in to finish it.",
    action: {
      stance: "aggressive",
      spatial: {
        reference: { kind: "target" },
        range: { kind: "engage", fraction: 0.5, tolerance: 0.15 },
        bearing: { kind: "toward", reference: { kind: "target" } },
      },
      targeting: {
        mode: { kind: "highestCost" },
        vulnerableWeight: 0.4,
        focusFire: true,
      },
      fire: "atWill",
      crew: "combat",
      cohesion: 0.5,
      retreat: 0.1,
    },
  },
};

/** The preset list in canonical display order (matches {@link POSTURE_KEYS}). */
export const POSTURE_PRESET_LIST: PosturePreset[] = POSTURE_KEYS.map(
  (key) => POSTURE_PRESETS[key],
);
