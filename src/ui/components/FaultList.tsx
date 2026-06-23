import { Alert, List, Stack } from "@mantine/core";
import { IconCircleCheck, IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import type { DesignFault } from "@/domain/stats";
import { formatWatts } from "@/ui/format";

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
    case "unknownLayerMaterial":
      return `Cell (${fault.col}, ${fault.row}) has no ${fault.layer} layer material for this design's faction.`;
    case "powerDeficit":
      return `Power deficit of ${formatWatts(Math.abs(fault.net))} — add a reactor.`;
    case "crewDeficit":
      return `Crew shortfall of ${Math.abs(fault.net).toFixed(0)} — add crew quarters.`;
    case "crossFaction":
      return `Mixed factions — this design is ${fault.expected} but contains parts from: ${fault.found.join(", ")}.`;
    case "unreachableStation":
      return `Station at (${fault.col}, ${fault.row}) is not walkable-reachable from any crew quarters — add a floor corridor connecting them.`;
    case "noAmmoSource":
      return `Weapon at (${fault.col}, ${fault.row}) has no reachable magazine — add a Munitions Magazine (or Ammon Sac) connected to this weapon.`;
    case "noSensors":
      return "No sensor module — the ship will rely on short visual range only and may not detect enemies until they are very close.";
    case "commsIsland":
      return `Comms unit at (${fault.col}, ${fault.row}) is on channel ${fault.channel} that nothing else on this ship uses — it can never form a link.`;
    case "unmannedAimUnit":
      return `Comms unit at (${fault.col}, ${fault.row}) is a aimed unit (dish or laser) that requires crew but has no walkable path from any crew quarters — it will never link.`;
    case "noRelay":
      return "Only one comms unit — a single unit cannot relay third-party contact data; add a second unit to enable relaying.";
    case "invalidHardwire":
      return `Invalid ${fault.resource} conduit from (${fault.from.col}, ${fault.from.row}) to (${fault.to.col}, ${fault.to.row}): ${fault.reason}.`;
  }
}

interface FaultListProps {
  faults: readonly DesignFault[];
}

/** Lists the build-constraint faults blocking a ship design, or confirms it. */
export function FaultList({ faults }: FaultListProps) {
  const errors = faults.filter((f) => f.severity === "error");
  const warnings = faults.filter((f) => f.severity === "warning");

  if (faults.length === 0) {
    return (
      <Alert icon={<IconCircleCheck size={16} />} color="teal" variant="light">
        Design is valid and ready to deploy.
      </Alert>
    );
  }

  return (
    <Stack gap="xs">
      {errors.length > 0 && (
        <Alert
          icon={<IconAlertTriangle size={16} />}
          color="red"
          variant="light"
          title="Cannot deploy as built"
        >
          <Stack gap={4}>
            <List size="sm" spacing={2} center>
              {errors.map((fault, index) => (
                <List.Item key={index}>{describe(fault)}</List.Item>
              ))}
            </List>
          </Stack>
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert
          icon={<IconInfoCircle size={16} />}
          color="yellow"
          variant="light"
          title="Advisories"
        >
          <Stack gap={4}>
            <List size="sm" spacing={2} center>
              {warnings.map((fault, index) => (
                <List.Item key={index}>{describe(fault)}</List.Item>
              ))}
            </List>
          </Stack>
        </Alert>
      )}
    </Stack>
  );
}
