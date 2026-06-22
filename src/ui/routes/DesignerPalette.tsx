import { Badge, Button, Group, Paper, Select, Stack, Text, Tooltip } from "@mantine/core";
import { type Brush, ADDABLE_SURFACES } from "./designerConstants";
import { brushLabel } from "./designerGrid";

/** Module definition summary for the equipment picker. */
interface ModuleOption {
  id: string;
  name: string;
  cost: number;
}

/**
 * The brush palette for the ship designer. Renders the full layered-brush
 * vocabulary: erase, substrate+surface (paint a fresh cell), resurface an
 * existing substrate cell (add/remove surface), edge toggles (wall/door), and
 * equipment mounting. All controls are disabled when the working design is
 * read-only (a preset).
 *
 * The palette is a controlled component: it calls `onChange` with the new
 * brush; the route owns the brush state so paint handlers can read it.
 */
export function DesignerPalette({
  brush,
  onChange,
  modules,
  readOnly,
}: {
  brush: Brush;
  onChange: (next: Brush) => void;
  modules: ReadonlyArray<ModuleOption>;
  readOnly: boolean;
}) {
  return (
    <Paper p="md" withBorder>
      <Stack gap="xs">
        <Group gap={4}>
          <Tooltip label="Remove the cell entirely (substrate + all layers)">
            <Button
              size="xs"
              variant={brush.kind === "empty" ? "filled" : "light"}
              data-active={brush.kind === "empty" ? "true" : undefined}
              color="gray"
              onClick={() => onChange({ kind: "empty" })}
              disabled={readOnly}
            >
              Erase
            </Button>
          </Tooltip>
        </Group>
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            Substrate + surface (paint a fresh cell)
          </Text>
          <Group gap={4}>
            <Tooltip label="Solid, impassable armor plate — high HP/mass, no equipment, sealed perimeter">
              <Button
                size="xs"
                variant={brush.kind === "substrate-armor" ? "filled" : "light"}
                data-active={brush.kind === "substrate-armor" ? "true" : undefined}
                onClick={() => onChange({ kind: "substrate-armor" })}
                disabled={readOnly}
              >
                armor
              </Button>
            </Tooltip>
            <Tooltip label="Walkable crew floor — corridors and equipment-mounting surface">
              <Button
                size="xs"
                variant={brush.kind === "substrate-deck" ? "filled" : "light"}
                data-active={brush.kind === "substrate-deck" ? "true" : undefined}
                color="yellow"
                onClick={() => onChange({ kind: "substrate-deck" })}
                disabled={readOnly}
              >
                deck
              </Button>
            </Tooltip>
            <Tooltip label="Low-mass framing — substrate-connected, not walkable">
              <Button
                size="xs"
                variant={brush.kind === "substrate-bare" ? "filled" : "light"}
                data-active={brush.kind === "substrate-bare" ? "true" : undefined}
                color="gray"
                onClick={() => onChange({ kind: "substrate-bare" })}
                disabled={readOnly}
              >
                bare
              </Button>
            </Tooltip>
          </Group>
        </Stack>
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            Resurface an existing substrate cell
          </Text>
          <Group gap={4}>
            {ADDABLE_SURFACES.map((surface) => (
              <Tooltip
                key={surface}
                label={
                  surface === "armor"
                    ? "Plate armor over an existing substrate cell (strips equipment, seals edges)"
                    : "Lay a deck over an existing substrate cell (walkable, equipment-mountable)"
                }
              >
                <Button
                  size="xs"
                  variant={
                    brush.kind === "add-surface" && brush.surface === surface
                      ? "filled"
                      : "light"
                  }
                  data-active={
                    brush.kind === "add-surface" && brush.surface === surface
                      ? "true"
                      : undefined
                  }
                  color={surface === "armor" ? "gray" : "yellow"}
                  onClick={() => onChange({ kind: "add-surface", surface })}
                  disabled={readOnly}
                >
                  + {surface}
                </Button>
              </Tooltip>
            ))}
            <Tooltip label="Strip the surface off a substrate cell, leaving bare framing">
              <Button
                size="xs"
                variant={brush.kind === "remove-surface" ? "filled" : "light"}
                data-active={brush.kind === "remove-surface" ? "true" : undefined}
                color="gray"
                onClick={() => onChange({ kind: "remove-surface" })}
                disabled={readOnly}
              >
                − surface
              </Button>
            </Tooltip>
          </Group>
        </Stack>
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            Edges (click an edge bar to toggle)
          </Text>
          <Group gap={4}>
            <Tooltip label="Click an edge: toggles wall on/off">
              <Button
                size="xs"
                variant={brush.kind === "edge-wall" ? "filled" : "light"}
                data-active={brush.kind === "edge-wall" ? "true" : undefined}
                onClick={() => onChange({ kind: "edge-wall" })}
                disabled={readOnly}
              >
                wall
              </Button>
            </Tooltip>
            <Tooltip label="Click an edge: toggles door; click an existing door to cycle open/closed">
              <Button
                size="xs"
                variant={brush.kind === "edge-door" ? "filled" : "light"}
                data-active={brush.kind === "edge-door" ? "true" : undefined}
                color="orange"
                onClick={() => onChange({ kind: "edge-door" })}
                disabled={readOnly}
              >
                door
              </Button>
            </Tooltip>
          </Group>
        </Stack>
        <Select
          label="Equipment"
          placeholder="Pick a module to mount on deck"
          data={modules.map((m) => ({
            value: m.id,
            label: `${m.name} — ${m.cost} pts`,
          }))}
          value={brush.kind === "equipment" ? brush.moduleId : null}
          onChange={(moduleId) =>
            moduleId !== null && onChange({ kind: "equipment", moduleId })
          }
          disabled={readOnly}
          searchable
        />
        <Badge variant="light" color="indigo">
          Brush: {brushLabel(brush)}
        </Badge>
      </Stack>
    </Paper>
  );
}
