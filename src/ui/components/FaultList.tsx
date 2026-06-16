import { Alert, List, Stack } from "@mantine/core";
import { IconCircleCheck, IconAlertTriangle } from "@tabler/icons-react";
import type { DesignFault } from "@/domain/stats";

function describe(fault: DesignFault): string {
  switch (fault.kind) {
    case "unknownSlot":
      return `Slot ${fault.slotId} does not exist on this hull.`;
    case "unknownModule":
      return `Slot ${fault.slotId} references an unknown module (${fault.moduleId}).`;
    case "slotTypeMismatch":
      return `Slot ${fault.slotId} is a ${fault.hullSlotType} slot but holds a ${fault.moduleSlotType} module.`;
    case "duplicateSlot":
      return `Slot ${fault.slotId} has more than one module assigned.`;
    case "massExceeded":
      return `Mass ${fault.mass.toFixed(0)} exceeds hull capacity ${fault.capacity}.`;
    case "powerDeficit":
      return `Power deficit of ${Math.abs(fault.net).toFixed(0)} — add a reactor.`;
    case "crewDeficit":
      return `Crew shortfall of ${Math.abs(fault.net).toFixed(0)} — add crew quarters.`;
  }
}

interface FaultListProps {
  faults: readonly DesignFault[];
}

/** Lists the build-constraint faults blocking a ship design, or confirms it. */
export function FaultList({ faults }: FaultListProps) {
  if (faults.length === 0) {
    return (
      <Alert icon={<IconCircleCheck size={16} />} color="teal" variant="light">
        Design is valid and ready to deploy.
      </Alert>
    );
  }

  return (
    <Alert
      icon={<IconAlertTriangle size={16} />}
      color="red"
      variant="light"
      title="Cannot deploy as built"
    >
      <Stack gap={4}>
        <List size="sm" spacing={2} center>
          {faults.map((fault, index) => (
            <List.Item key={index}>{describe(fault)}</List.Item>
          ))}
        </List>
      </Stack>
    </Alert>
  );
}
