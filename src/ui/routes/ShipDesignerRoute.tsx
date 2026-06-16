import {
  ActionIcon,
  Badge,
  Button,
  Grid,
  Group,
  NativeSelect,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconBucketDroplet, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { analyseShipDesign } from "@/domain/stats";
import { createId, nowIso } from "@/domain/id";
import { catalog } from "@/data/catalog";
import { FaultList } from "@/ui/components/FaultList";
import { ShareButton } from "@/ui/components/ShareButton";
import { StatReadout } from "@/ui/components/StatReadout";
import { useShipDesigns } from "@/ui/hooks/storage";
import { storage } from "@/storage/db";
import type { ModulePlacement, ShipDesign } from "@/schema/ship";
import type { HullDefinition } from "@/schema/hull";
import type { ModuleSlotType } from "@/schema/module";

interface WorkingDesign {
  id: string | null;
  createdAt: string | null;
  name: string;
  hullId: string;
  faction: string;
  placements: ModulePlacement[];
}

function blankDesign(firstHullId: string): WorkingDesign {
  return {
    id: null,
    createdAt: null,
    name: "",
    hullId: firstHullId,
    faction: "Terran",
    placements: [],
  };
}

function moduleInSlot(
  placements: readonly ModulePlacement[],
  slotId: string,
): string | undefined {
  return placements.find((p) => p.slotId === slotId)?.moduleId;
}

function setModuleInSlot(
  placements: ModulePlacement[],
  slotId: string,
  moduleId: string | undefined,
): ModulePlacement[] {
  const without = placements.filter((p) => p.slotId !== slotId);
  return moduleId === undefined ? without : [...without, { slotId, moduleId }];
}

/** Schematic of the hull: outline polygon plus a dot per slot, lit when fitted. */
function HullMap({
  hull,
  placements,
}: {
  hull: HullDefinition;
  placements: readonly ModulePlacement[];
}) {
  const points = [...hull.shape.outline, ...hull.slots.map((s) => s.position)];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 12;
  const width = maxX - minX + pad * 2;
  const height = maxY - minY + pad * 2;

  const slotColour: Record<ModuleSlotType, string> = {
    weapon: "#ff8c5a",
    general: "#6ea8ff",
    engine: "#7bd88f",
    system: "#c792ff",
  };

  const outline = hull.shape.outline
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${p.x - minX + pad} ${p.y - minY + pad}`,
    )
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      style={{ maxHeight: 240 }}
    >
      <path
        d={outline}
        fill="rgba(80,100,160,0.12)"
        stroke="rgba(140,160,220,0.5)"
        strokeWidth={1}
      />
      {hull.slots.map((slot) => {
        const filled = moduleInSlot(placements, slot.id) !== undefined;
        return (
          <circle
            key={slot.id}
            cx={slot.position.x - minX + pad}
            cy={slot.position.y - minY + pad}
            r={filled ? 4 : 3}
            fill={filled ? slotColour[slot.type] : "transparent"}
            stroke={slotColour[slot.type]}
            strokeWidth={1.5}
          />
        );
      })}
    </svg>
  );
}

const SLOT_TYPE_LABEL: Record<ModuleSlotType, string> = {
  weapon: "Weapon",
  general: "General",
  engine: "Engine",
  system: "System",
};

export function ShipDesignerRoute() {
  const designs = useShipDesigns();
  const hulls = catalog().allHulls();
  const firstHullId = hulls[0]?.id;
  const [working, setWorking] = useState<WorkingDesign>(() =>
    blankDesign(firstHullId ?? "hull-wasp"),
  );

  const hull = useMemo(
    () => catalog().hull(working.hullId),
    [working.hullId],
  );

  const analysis = useMemo(() => {
    if (hull === undefined) return null;
    const design: ShipDesign = {
      id: working.id ?? "draft",
      name: working.name || "Draft",
      hullId: working.hullId,
      faction: working.faction || "Unaligned",
      placements: working.placements,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    return analyseShipDesign(design, hull, catalog());
  }, [working, hull]);

  if (designs === undefined || firstHullId === undefined) {
    return <Text c="dimmed">Loading…</Text>;
  }
  const firstHull: string = firstHullId;

  async function save() {
    if (hull === undefined || analysis === null) return;
    const now = nowIso();
    const design: ShipDesign = {
      id: working.id ?? createId("design"),
      name: working.name.trim() || "Untitled Design",
      hullId: working.hullId,
      faction: working.faction.trim() || "Unaligned",
      placements: working.placements,
      createdAt: working.createdAt ?? now,
      updatedAt: now,
    };
    await storage().ships.save(design);
    setWorking((prev) => ({
      ...prev,
      id: design.id,
      createdAt: design.createdAt,
    }));
    notifications.show({
      title: "Design saved",
      message: `${design.name} is in your roster.`,
      color: "teal",
    });
  }

  async function remove(id: string) {
    await storage().ships.remove(id);
    if (working.id === id) {
      setWorking(blankDesign(firstHull));
    }
    notifications.show({ message: "Design deleted", color: "gray" });
  }

  function load(design: ShipDesign) {
    setWorking({
      id: design.id,
      createdAt: design.createdAt,
      name: design.name,
      hullId: design.hullId,
      faction: design.faction,
      placements: [...design.placements],
    });
  }

  return (
    <Stack gap="lg">
      <Title order={2}>Ship Designer</Title>

      <Grid gap="lg">
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Paper p="md" withBorder>
            <Group justify="space-between" mb="sm">
              <Text fw={600}>Your designs</Text>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconPlus size={14} />}
                onClick={() => setWorking(blankDesign(firstHull))}
              >
                New
              </Button>
            </Group>
            <ScrollArea.Autosize mah={420} offsetScrollbars>
              <Stack gap={6}>
                {designs.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    No saved designs yet. Build one and save it.
                  </Text>
                ) : (
                  designs.map((design) => (
                    <Group
                      key={design.id}
                      justify="space-between"
                      wrap="nowrap"
                    >
                      <Button
                        variant={design.id === working.id ? "filled" : "subtle"}
                        size="xs"
                        fullWidth
                        justify="space-between"
                        onClick={() => load(design)}
                      >
                        <span>{design.name}</span>
                      </Button>
                      <Tooltip label="Delete">
                        <ActionIcon
                          color="red"
                          variant="subtle"
                          onClick={() => remove(design.id)}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  ))
                )}
              </Stack>
            </ScrollArea.Autosize>
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 8 }}>
          {hull === undefined || analysis === null ? (
            <Text c="dimmed">Pick a hull to begin.</Text>
          ) : (
            <Stack gap="md">
              <Group grow align="flex-start">
                <TextInput
                  label="Name"
                  value={working.name}
                  onChange={(e) =>
                    setWorking((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="e.g. Sabre Mk II"
                />
                <NativeSelect
                  label="Hull"
                  value={working.hullId}
                  onChange={(e) =>
                    setWorking((prev) => ({
                      ...prev,
                      hullId: e.target.value,
                      placements: [],
                    }))
                  }
                >
                  {hulls.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} ({h.classification})
                    </option>
                  ))}
                </NativeSelect>
                <TextInput
                  label="Faction"
                  value={working.faction}
                  onChange={(e) =>
                    setWorking((prev) => ({ ...prev, faction: e.target.value }))
                  }
                />
              </Group>

              <Grid gap="md">
                <Grid.Col span={{ base: 12, lg: 5 }}>
                  <Paper p="md" withBorder>
                    <HullMap hull={hull} placements={working.placements} />
                  </Paper>
                </Grid.Col>
                <Grid.Col span={{ base: 12, lg: 7 }}>
                  <Stack gap="xs">
                    <Text size="sm" fw={600}>
                      Modules
                    </Text>
                    {hull.slots.map((slot) => {
                      const options = catalog()
                        .allModules()
                        .filter((m) => m.slotType === slot.type)
                        .map((m) => ({
                          value: m.id,
                          label: `${m.name} — ${m.cost} pts`,
                        }));
                      const value = moduleInSlot(working.placements, slot.id);
                      return (
                        <Select
                          key={slot.id}
                          label={
                            <Group gap={6}>
                              <Badge
                                size="xs"
                                variant="light"
                                color="indigo"
                              >
                                {SLOT_TYPE_LABEL[slot.type]}
                              </Badge>
                              <Text size="xs" c="dimmed">
                                {slot.id}
                              </Text>
                            </Group>
                          }
                          data={options}
                          value={value ?? null}
                          onChange={(moduleId) =>
                            setWorking((prev) => ({
                              ...prev,
                              placements: setModuleInSlot(
                                prev.placements,
                                slot.id,
                                moduleId ?? undefined,
                              ),
                            }))
                          }
                          placeholder="Empty"
                          clearable
                          searchable
                        />
                      );
                    })}
                  </Stack>
                </Grid.Col>
              </Grid>

              <Paper p="md" withBorder>
                <StatReadout
                  stats={analysis.stats}
                  massCapacity={hull.massCapacity}
                />
              </Paper>

              <FaultList faults={analysis.faults} />

              <Group justify="space-between">
                <ShareButton
                  shareable={{
                    kind: "shipDesign",
                    value: {
                      id: working.id ?? "draft",
                      name: working.name || "Untitled",
                      hullId: working.hullId,
                      faction: working.faction || "Unaligned",
                      placements: working.placements,
                      createdAt: working.createdAt ?? nowIso(),
                      updatedAt: nowIso(),
                    },
                  }}
                />
                <Button
                  onClick={save}
                  leftSection={<IconBucketDroplet size={16} />}
                >
                  Save design
                </Button>
              </Group>
            </Stack>
          )}
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
