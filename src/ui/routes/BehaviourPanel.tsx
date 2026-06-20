import { Paper, Select, Stack, Text } from "@mantine/core";
import {
  type CrewPriority as CrewPriorityType,
  type ShipStance as ShipStanceType,
  CrewPriority,
  ShipStance,
} from "@/schema/ai";

/** Stance and crew-priority option lists, sourced from the schema enums so the
 *  designer cannot drift from the canonical vocabulary. The literals come from
 *  `ShipStance.options` / `CrewPriority.options` (Zod exposes the enum's
 *  literal union as `.options`), so adding a stance in the schema automatically
 *  surfaces it here. */
const STANCE_OPTIONS = ShipStance.options.map((s) => ({ value: s, label: s }));
const CREW_PRIORITY_OPTIONS = CrewPriority.options.map((p) => ({
  value: p,
  label: p,
}));

/**
 * The behaviour panel: the ship's base stance and the crew task-scheduler
 * priority mode. Both are persisted on the design (schema fields
 * `shipStance` / `crewPriority`) and read by the AI interpreter when it lands.
 * The trigger/action rule list is not yet editable in the designer; it will
 * follow in a later pass.
 */
export function BehaviourPanel({
  shipStance,
  crewPriority,
  readOnly,
  onStanceChange,
  onPriorityChange,
}: {
  shipStance: ShipStanceType;
  crewPriority: CrewPriorityType;
  readOnly: boolean;
  onStanceChange: (next: ShipStanceType) => void;
  onPriorityChange: (next: CrewPriorityType) => void;
}) {
  return (
    <Paper p="md" withBorder>
      <Stack gap="xs">
        <Select
          label="Ship stance"
          size="xs"
          data={STANCE_OPTIONS}
          value={shipStance}
          disabled={readOnly}
          onChange={(v) => {
            if (v !== null) onStanceChange(ShipStance.parse(v));
          }}
        />
        <Select
          label="Crew priority"
          size="xs"
          data={CREW_PRIORITY_OPTIONS}
          value={crewPriority}
          disabled={readOnly}
          onChange={(v) => {
            if (v !== null) onPriorityChange(CrewPriority.parse(v));
          }}
        />
        <Text size="xs" c="dimmed">
          Trigger/action rules are not yet editable in the designer; they will
          follow in a later pass.
        </Text>
      </Stack>
    </Paper>
  );
}
