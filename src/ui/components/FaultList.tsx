import { Alert, List, Stack } from "@mantine/core";
import { IconCircleCheck, IconAlertTriangle } from "@tabler/icons-react";
import type { DesignFault } from "@/domain/stats";

function describe(fault: DesignFault): string {
  switch (fault.kind) {
    case "empty":
      return "The grid is empty — lay down at least one hull or module cell.";
    case "disconnected":
      return "Cells are not all connected — every cell must share an edge with the rest.";
    case "noCommand":
      return "No command module — add a reactor (it doubles as the bridge).";
    case "unknownModule":
      return `Cell (${fault.col}, ${fault.row}) references an unknown module (${fault.moduleId}).`;
    case "unknownHullTile":
      return `Cell (${fault.col}, ${fault.row}) uses an unknown hull tile (${fault.tile}).`;
    case "massExceeded":
      return `Mass ${fault.mass.toFixed(0)} exceeds the grid budget ${fault.capacity}.`;
    case "powerDeficit":
      return `Power deficit of ${Math.abs(fault.net).toFixed(0)} — add a reactor.`;
    case "crewDeficit":
      return `Crew shortfall of ${Math.abs(fault.net).toFixed(0)} — add crew quarters.`;
    case "crossFaction":
      return `Mixed factions — this design is ${fault.expected} but contains parts from: ${fault.found.join(", ")}.`;
    case "unreachableStation":
      return `Station at (${fault.col}, ${fault.row}) is not walkable-reachable from any crew quarters — add a floor corridor connecting them.`;
    case "noAmmoSource":
      return `Weapon at (${fault.col}, ${fault.row}) has no reachable magazine — add a Munitions Magazine (or Ammon Sac) connected to this weapon.`;
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
