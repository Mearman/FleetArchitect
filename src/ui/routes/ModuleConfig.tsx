import { Select, Slider, Stack, Text } from "@mantine/core";
import type { CommsEffect, SensorEffect } from "@/schema/module";
import type { ModuleCell } from "@/schema/grid";

/**
 * Per-instance comms configuration panel for a selected comms module cell.
 * Shows a channel selector always; a bearing control for directional/laser
 * units; and a range slider for variable units.
 */
export function CommsConfig({
  cell,
  effect,
  onChannelChange,
  onBearingChange,
  onRangeChange,
}: {
  cell: ModuleCell;
  effect: CommsEffect;
  onChannelChange: (channel: number) => void;
  onBearingChange: (bearing: number) => void;
  onRangeChange: (range: number) => void;
}) {
  // Effective per-instance values, falling back to the module definition's defaults.
  const effectiveChannel = cell.channel ?? effect.channel;
  const effectiveBearing = cell.commsBearing ?? effect.bearing;
  const effectiveRange = cell.commsRange ?? effect.range;

  const showBearing =
    effect.commsType === "directional" ||
    effect.commsType === "dish" ||
    effect.commsType === "laser";
  const showRange = effect.commsType === "variable";

  // Bearing expressed as degrees for display, stored as radians.
  const bearingDeg = Math.round((effectiveBearing * 180) / Math.PI);

  // Channel options: 0–7 is a reasonable range for the designer.
  const CHANNEL_OPTIONS: { value: string; label: string }[] = Array.from(
    { length: 8 },
    (_, i) => ({ value: `${i}`, label: `Ch ${i}` }),
  );

  // Bearing options: the four cardinal directions plus diagonals (0°, 45°, …, 315°).
  const BEARING_OPTIONS: { value: string; label: string }[] = [
    { value: "0",    label: "Fwd (0°)" },
    { value: "45",   label: "45°" },
    { value: "90",   label: "Stbd (90°)" },
    { value: "135",  label: "135°" },
    { value: "180",  label: "Aft (180°)" },
    { value: "225",  label: "225°" },
    { value: "270",  label: "Port (270°)" },
    { value: "315",  label: "315°" },
  ];

  const rangeMin = effect.minRange ?? 0;
  const rangeMax = effect.maxRange ?? effect.range;

  return (
    <Stack gap={6} mt="sm">
      <Text size="xs" c="dimmed">
        Comms configuration
      </Text>

      {/* Channel selector — always shown for comms cells */}
      <Select
        label="Channel"
        size="xs"
        data={CHANNEL_OPTIONS}
        value={`${effectiveChannel}`}
        onChange={(v) => {
          if (v !== null) onChannelChange(Number.parseInt(v, 10));
        }}
      />

      {/* Fixed bearing — directional, dish, and laser units */}
      {showBearing ? (
        <Select
          label={`Bearing (current: ${bearingDeg}°)`}
          size="xs"
          data={BEARING_OPTIONS}
          value={`${bearingDeg}`}
          onChange={(v) => {
            if (v !== null) {
              const deg = Number.parseInt(v, 10);
              onBearingChange((deg * Math.PI) / 180);
            }
          }}
        />
      ) : null}

      {/* Range slider — variable units only */}
      {showRange ? (
        <Stack gap={2}>
          <Text size="xs">
            Range: {effectiveRange.toFixed(0)} units
          </Text>
          <Slider
            size="xs"
            min={rangeMin}
            max={rangeMax}
            value={effectiveRange}
            onChange={onRangeChange}
          />
        </Stack>
      ) : null}
    </Stack>
  );
}

/**
 * Per-instance sensor configuration panel for a selected sensor module cell.
 * Shows a fixed bearing control for directional/dish units and a range slider
 * for variable units; omni units need no per-instance tuning.
 */
export function SensorConfig({
  cell,
  effect,
  onBearingChange,
  onRangeChange,
}: {
  cell: ModuleCell;
  effect: SensorEffect;
  onBearingChange: (bearing: number) => void;
  onRangeChange: (range: number) => void;
}) {
  // Effective per-instance values, falling back to the module definition's defaults.
  const effectiveBearing = cell.sensorBearing ?? effect.bearing;
  const effectiveRange = cell.sensorRangeSetting ?? effect.detectionRange;

  // Directional and dish units have a fixed facing the designer can aim.
  // Variable units are electronically steered via the range dial instead.
  // Omni units need no per-instance tuning.
  const showBearing =
    effect.sensorType === "directional" || effect.sensorType === "dish";
  const showRange = effect.sensorType === "variable";

  // Bearing expressed as degrees for display, stored as radians.
  const bearingDeg = Math.round((effectiveBearing * 180) / Math.PI);

  // Bearing options: the four cardinal directions plus diagonals (0°, 45°, …, 315°).
  const BEARING_OPTIONS: { value: string; label: string }[] = [
    { value: "0",    label: "Fwd (0°)" },
    { value: "45",   label: "45°" },
    { value: "90",   label: "Stbd (90°)" },
    { value: "135",  label: "135°" },
    { value: "180",  label: "Aft (180°)" },
    { value: "225",  label: "225°" },
    { value: "270",  label: "Port (270°)" },
    { value: "315",  label: "315°" },
  ];

  const rangeMin = effect.minRange ?? 0;
  const rangeMax = effect.maxRange ?? effect.detectionRange;

  return (
    <Stack gap={6} mt="sm">
      <Text size="xs" c="dimmed">
        Sensor configuration
      </Text>

      {/* Fixed bearing — directional and dish units */}
      {showBearing ? (
        <Select
          label={`Bearing (current: ${bearingDeg}°)`}
          size="xs"
          data={BEARING_OPTIONS}
          value={`${bearingDeg}`}
          onChange={(v) => {
            if (v !== null) {
              const deg = Number.parseInt(v, 10);
              onBearingChange((deg * Math.PI) / 180);
            }
          }}
        />
      ) : null}

      {/* Range slider — variable units only. Raising range narrows the arc. */}
      {showRange ? (
        <Stack gap={2}>
          <Text size="xs">
            Range: {effectiveRange.toFixed(0)} units
          </Text>
          <Slider
            size="xs"
            min={rangeMin}
            max={rangeMax}
            value={effectiveRange}
            onChange={onRangeChange}
          />
        </Stack>
      ) : null}
    </Stack>
  );
}
