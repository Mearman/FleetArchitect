import {
  Anchor,
  Button,
  Collapse,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowsLeftRight,
  IconBucketDroplet,
  IconHistory,
  IconSwords,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { applyPattern } from "@/domain/formation-layout";
import {
  type Path,
  appendChild,
  moveWithin,
  removeNode,
  updateFormation,
  updateNode,
} from "@/domain/formation-tree-state";
import { createId, nowIso } from "@/domain/id";
import { analyseShipDesign } from "@/domain/stats";
import { deriveClassification } from "@/domain/grid";
import { catalog } from "@/data/catalog";
import { ShareButton } from "@/ui/components/ShareButton";
import { VersionHistoryPanel } from "@/ui/components/VersionHistoryPanel";
import { CassettePanel } from "@/ui/components/CassettePanel";
import { ShipBrowser } from "@/ui/components/ShipBrowser";
import { useFleets, useFormationTemplates, useShipDesigns } from "@/ui/hooks/storage";
import {
  deleteFleet,
  deleteFormationTemplate,
  listFleetRevisions,
  restoreFleetRevision,
  saveFleet,
  saveFormationTemplate,
} from "@/storage/db";
import type { Fleet, FleetShip } from "@/schema/fleet";
import type { Formation, FormationNode } from "@/schema/formation";
import type { FormationLayout } from "@/schema/formation";
import type { FormationTemplate } from "@/schema/formation-template";
import { flattenShipLeaves } from "@/schema/formation";
import type { ShipDesign } from "@/schema/ship";
import { referencedTemplates } from "@/sharing/data-url";
import type { Shareable } from "@/sharing/data-url";
import { panelLabel } from "@/ui/components/panel.css";
import { hardwareKey } from "@/ui/theme/controls.css";
import { FACTION_PALETTE } from "@/ui/routes/battleConstants";
import { BudgetReadout } from "./BudgetReadout";
import { FormationTreeView, type ShipLookup, type TemplateLookup, type TreeOps } from "./FormationTreeView";
import { SavedFleetsList } from "./SavedFleetsList";
import { SpatialCanvas } from "./SpatialCanvas";
import { TemplateLibrary } from "./TemplateLibrary";
import {
  actionBar,
  canvasRegion,
  centre,
  centreBody,
  centreFooter,
  modeBanner,
  rightColumn,
  rosterRegion,
  routeRoot,
  splitWing,
  titleStrip,
  wing,
  wingBody,
  workspace,
} from "./FleetBuilderRoute.css";

/** What the working state is editing: a fleet (top-level) or a single template. */
type EditKind = "fleet" | "template";

/** The working state: the formation tree plus the identity of what is edited.
 *  The tree is the same shape whether editing a fleet or a template — only the
 *  save target and share kind differ. */
interface WorkingState {
  kind: EditKind;
  /** Fleet id / template id; null when the record is new (unsaved). */
  id: string | null;
  createdAt: string | null;
  name: string;
  faction: string;
  formation: Formation;
}

/** An empty root formation — the blank-fleet and blank-template base shape. */
function emptyRoot(): Formation {
  return { id: "root", doctrine: { base: {}, rules: [] }, children: [] };
}

function blankFleet(): WorkingState {
  return {
    kind: "fleet",
    id: null,
    createdAt: null,
    name: "",
    faction: "Terran",
    formation: emptyRoot(),
  };
}

/** The default doctrine seeded onto a freshly added ship leaf so the editor
 *  always has a concrete doctrine to edit (matches the prior row-based path). */

/** A freshly added ship leaf, seeded at the legacy spread position. */
function newShipLeaf(designId: string, index: number): FormationNode {
  const ship: FleetShip = {
    designId,
    position: { x: -300 + (index % 3) * 50, y: ((index % 5) - 2) * 80 },
    facing: 0,
    doctrine: { base: {}, rules: [] },
  };
  return { kind: "ship", ship };
}

/** A fresh empty sub-formation node. */
function newFormationNode(): FormationNode {
  return {
    kind: "formation",
    formation: { id: createId("formation"), doctrine: { base: {}, rules: [] }, children: [] },
  };
}

/** Read the formation at a path (root when empty). Undefined if the path does
 *  not resolve to a formation (a ship/template leaf, or out of range). */
function formationAtFocus(root: Formation, path: Path): Formation | undefined {
  if (path.length === 0) return root;
  let current: Formation = root;
  for (let i = 0; i < path.length; i += 1) {
    const step = path[i];
    if (step === undefined) return undefined;
    const child = current.children[step];
    if (child === undefined || child.kind !== "formation") return undefined;
    current = child.formation;
  }
  return current;
}

export function FleetBuilderRoute() {
  const fleets = useFleets();
  const designs = useShipDesigns();
  const templates = useFormationTemplates();
  const [working, setWorking] = useState<WorkingState>(blankFleet);
  const [focusPath, setFocusPath] = useState<Path>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisions, setRevisions] = useState<Fleet[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saveAsTpl, setSaveAsTpl] = useState<{ path: Path; name: string } | null>(null);
  const factions = catalog().factions();
  const isTemplate = working.kind === "template";

  /** Tree operations, bound to the working formation. Every helper is pure
   *  (from formation-tree-state); these wrappers thread them through React state. */
  const ops: TreeOps = useMemo(
    () => ({
      updateFormation: (path, fn) =>
        setWorking((w) => ({ ...w, formation: updateFormation(w.formation, path, fn) })),
      updateNode: (path, fn) =>
        setWorking((w) => ({ ...w, formation: updateNode(w.formation, path, fn) })),
      appendChild: (parentPath, node) =>
        setWorking((w) => ({ ...w, formation: appendChild(w.formation, parentPath, node) })),
      removeNode: (path) => setWorking((w) => ({ ...w, formation: removeNode(w.formation, path) })),
      moveWithin: (parentPath, from, to) =>
        setWorking((w) => ({ ...w, formation: moveWithin(w.formation, parentPath, from, to) })),
    }),
    [],
  );

  const designInfo = useMemo(() => {
    const map = new Map<string, { design: ShipDesign; cost: number; classification: string }>();
    for (const d of designs ?? []) {
      const { stats } = analyseShipDesign(d, catalog());
      map.set(d.id, { design: d, cost: stats.cost, classification: deriveClassification(d.grid) });
    }
    return map;
  }, [designs]);

  const shipLookup: ShipLookup = (designId) => {
    const info = designInfo.get(designId);
    if (info === undefined) {
      return { design: undefined, cost: 0, classification: "missing", missing: true };
    }
    return { ...info, missing: false };
  };

  const templateLookup: TemplateLookup = (templateId) => {
    const list = templates ?? [];
    return list.find((t) => t.id === templateId);
  };

  const factionDesigns = useMemo(
    () => (designs ?? []).filter((d) => d.faction === working.faction),
    [designs, working.faction],
  );

  const total = useMemo(() => {
    let sum = 0;
    for (const ship of flattenShipLeaves(working.formation)) {
      const info = designInfo.get(ship.designId);
      if (info !== undefined) sum += info.cost;
    }
    return sum;
  }, [working.formation, designInfo]);

  const overBudget = !isTemplate && total > 20000;
  const accent = paletteAccent(working.faction);

  const focusedFormation = useMemo(
    () => formationAtFocus(working.formation, focusPath),
    [working.formation, focusPath],
  );
  const focusLabel = focusedFormation?.role ?? focusedFormation?.id ?? "root";

  const shareable = useMemo<Shareable>(() => {
    if (working.kind === "template") {
      const now = nowIso();
      const template: FormationTemplate = {
        id: working.id ?? "draft",
        name: working.name || "Untitled template",
        faction: working.faction || "Unaligned",
        formation: working.formation,
        createdAt: working.createdAt ?? now,
        updatedAt: now,
        source: "user",
        revision: 1,
      };
      return { kind: "formationTemplate", value: template };
    }
    const now = nowIso();
    const fleet: Fleet = {
      id: working.id ?? "draft",
      name: working.name || "Untitled",
      faction: working.faction || "Unaligned",
      formation: working.formation,
      createdAt: working.createdAt ?? now,
      updatedAt: now,
      source: "user",
      revision: 1,
    };
    return {
      kind: "fleet",
      value: { fleet, templates: referencedTemplates([fleet], templates ?? []) },
    };
  }, [working, templates]);

  if (fleets === undefined || designs === undefined) {
    return (
      <Text c="dimmed" role="status" aria-live="polite">
        Loading…
      </Text>
    );
  }

  function addShip(design: ShipDesign) {
    const index = flattenShipLeaves(working.formation).length;
    ops.appendChild(focusPath, newShipLeaf(design.id, index));
  }

  function addSubFormation(parentPath: Path) {
    ops.appendChild(parentPath, newFormationNode());
  }

  function insertTemplate(templateId: string) {
    ops.appendChild(focusPath, { kind: "template", templateId });
    notifications.show({
      message: `Template reference added to “${focusLabel}”.`,
      color: "teal",
    });
  }

  /** Apply a pattern layout to a formation AND regenerate its children's slots,
   *  so the preview reflects the new arrangement immediately. Column clears the
   *  slots (children fall back to the lateral-line pattern). */
  function applyPatternLayout(path: Path, layout: FormationLayout) {
    ops.updateFormation(path, (f) => ({
      ...f,
      layout,
      children:
        layout.kind === "pattern"
          ? applyPattern(f.children, layout)
          : f.children.map((c) => ({ ...c, slot: undefined })),
    }));
  }

  async function save() {
    const now = nowIso();
    if (working.kind === "template") {
      const template: FormationTemplate = {
        id: working.id ?? createId("tpl"),
        name: working.name.trim() || "Untitled template",
        faction: working.faction.trim() || "Unaligned",
        formation: working.formation,
        createdAt: working.createdAt ?? now,
        updatedAt: now,
        source: "user",
        revision: 1,
      };
      await saveFormationTemplate(template);
      setWorking((w) => ({ ...w, id: template.id, createdAt: template.createdAt }));
      notifications.show({
        title: "Template saved",
        message: `${template.name} is stored.`,
        color: "teal",
      });
      return;
    }
    const fleet: Fleet = {
      id: working.id ?? createId("fleet"),
      name: working.name.trim() || "Untitled Fleet",
      faction: working.faction.trim() || "Unaligned",
      formation: working.formation,
      createdAt: working.createdAt ?? now,
      updatedAt: now,
      source: "user",
      revision: 1,
    };
    await saveFleet(fleet);
    setWorking((w) => ({ ...w, id: fleet.id, createdAt: fleet.createdAt }));
    notifications.show({
      title: "Fleet saved",
      message: `${fleet.name} is ready for battle.`,
      color: "teal",
    });
  }

  async function removeFleet(id: string) {
    await deleteFleet(id);
    if (working.id === id) {
      setWorking(blankFleet());
      setFocusPath([]);
    }
    notifications.show({ message: "Fleet deleted", color: "gray" });
  }

  async function removeTemplate(id: string) {
    await deleteFormationTemplate(id);
    if (working.kind === "template" && working.id === id) {
      setWorking(blankFleet());
      setFocusPath([]);
    }
    notifications.show({ message: "Template deleted", color: "gray" });
  }

  function loadFleet(fleet: Fleet) {
    setWorking({
      kind: "fleet",
      id: fleet.id,
      createdAt: fleet.createdAt,
      name: fleet.name,
      faction: fleet.faction,
      formation: fleet.formation,
    });
    setFocusPath([]);
  }

  function loadTemplate(template: FormationTemplate) {
    setWorking({
      kind: "template",
      id: template.id,
      createdAt: template.createdAt,
      name: template.name,
      faction: template.faction,
      formation: structuredClone(template.formation),
    });
    setFocusPath([]);
  }

  async function openHistory() {
    if (working.kind !== "fleet") return;
    const id = working.id;
    if (id === null) {
      setRevisions([]);
      setHistoryOpen((p) => !p);
      return;
    }
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setHistoryLoading(true);
    setHistoryOpen(true);
    const list = await listFleetRevisions(id);
    setRevisions(list);
    setHistoryLoading(false);
  }

  async function restoreRevision(revision: number) {
    if (working.kind !== "fleet" || working.id === null) return;
    const restored = await restoreFleetRevision(working.id, revision);
    loadFleet(restored);
    const list = await listFleetRevisions(restored.id);
    setRevisions(list);
    notifications.show({
      title: "Revision restored",
      message: `Fleet rolled back to revision ${revision}.`,
      color: "teal",
    });
  }

  /** Extract the formation at `path` into a new stored template. The subtree is
   *  deep-cloned so later edits to the fleet do not mutate the template. */
  async function confirmSaveAsTemplate() {
    if (saveAsTpl === null) return;
    const formation = formationAtFocus(working.formation, saveAsTpl.path);
    if (formation === undefined) {
      setSaveAsTpl(null);
      return;
    }
    const now = nowIso();
    const template: FormationTemplate = {
      id: createId("tpl"),
      name: saveAsTpl.name.trim() || "Untitled template",
      faction: working.faction.trim() || "Unaligned",
      formation: structuredClone(formation),
      createdAt: now,
      updatedAt: now,
      source: "user",
      revision: 1,
    };
    await saveFormationTemplate(template);
    notifications.show({
      title: "Template created",
      message: `${template.name} is stored and can be inserted into any fleet.`,
      color: "teal",
    });
    setSaveAsTpl(null);
  }

  const shipCount = flattenShipLeaves(working.formation).length;
  const canBuild = designs.length > 0;

  return (
    <div className={routeRoot}>
      <div className={titleStrip}>
        {isTemplate ? `Template editor — ${working.name || "untitled"}` : "Fleet Builder"}
      </div>
      {isTemplate && (
        <div className={modeBanner}>
          <span>Editing template</span>
          <Button
            size="xs"
            variant="subtle"
            className={hardwareKey}
            leftSection={<IconArrowsLeftRight size={14} />}
            onClick={() => {
              setWorking(blankFleet());
              setFocusPath([]);
            }}
          >
            Back to fleet
          </Button>
        </div>
      )}

      <div className={workspace}>
        {/* LEFT WING: saved fleets (fleet mode) or template-mode help */}
        <CassettePanel label={isTemplate ? "Templates" : "Fleets"} className={wing}>
          <div className={wingBody}>
            {isTemplate ? (
              <TemplateLibrary
                templates={templates}
                onInsert={insertTemplate}
                onEdit={loadTemplate}
                onDelete={(id) => void removeTemplate(id)}
                canInsert={false}
              />
            ) : (
              <SavedFleetsList
                fleets={fleets}
                activeId={working.id}
                onLoad={loadFleet}
                onDelete={(id) => void removeFleet(id)}
                onNew={() => {
                  setWorking(blankFleet());
                  setFocusPath([]);
                }}
              />
            )}
          </div>
        </CassettePanel>

        {/* CENTRE: identity + deployment canvas + tree roster + footer */}
        <CassettePanel className={centre}>
          <div className={centreBody}>
            <Group grow align="flex-start">
              <TextInput
                label={isTemplate ? "Template name" : "Fleet name"}
                value={working.name}
                onChange={(e) => setWorking((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={isTemplate ? "e.g. Vanguard wedge" : "e.g. 3rd Strike Wing"}
              />
              <Select
                label="Faction"
                data={factions.map((f) => ({ value: f, label: f }))}
                value={working.faction}
                onChange={(f) => {
                  if (f !== null) setWorking((prev) => ({ ...prev, faction: f }));
                }}
              />
            </Group>

            {/* Deployment preview */}
            <CassettePanel label="Deployment preview" className={canvasRegion}>
              <SpatialCanvas
                root={working.formation}
                templates={templateMap(templates)}
                focusPath={focusPath}
                onUpdateNode={ops.updateNode}
                onApplyPattern={applyPatternLayout}
                focusLabel={focusLabel}
              />
            </CassettePanel>

            <div className={panelLabel} style={{ marginTop: 4 }}>
              {isTemplate ? "Formation tree" : "Ships & formations"} ({shipCount} ship{shipCount === 1 ? "" : "s"})
            </div>

            <div className={rosterRegion}>
              {!canBuild && !isTemplate ? (
                <Text size="sm" c="dimmed">
                  <Anchor component={Link} to="/ships" size="sm">
                    Design a ship
                  </Anchor>{" "}
                  first before building a fleet.
                </Text>
              ) : shipCount === 0 && working.formation.children.length === 0 ? (
                <Text size="sm" c="dimmed">
                  Click a ship in the browser on the right to add it to “{focusLabel}”, or add a
                  sub-formation to start nesting.
                </Text>
              ) : (
                <FormationTreeView
                  root={working.formation}
                  shipLookup={shipLookup}
                  templateLookup={templateLookup}
                  accent={accent}
                  overBudget={overBudget}
                  focusPath={focusPath}
                  ops={ops}
                  onAddSubFormation={addSubFormation}
                  onSaveAsTemplate={(path) => {
                    const f = formationAtFocus(working.formation, path);
                    return setSaveAsTpl({
                      path,
                      name: f?.role ?? f?.id ?? "New template",
                    });
                  }}
                  onFocus={setFocusPath}
                />
              )}
            </div>

            <div className={centreFooter}>
              {!isTemplate && <BudgetReadout total={total} />}

              <Collapse expanded={historyOpen}>
                <VersionHistoryPanel
                  loading={historyLoading}
                  revisions={revisions}
                  onRestore={(revision) => void restoreRevision(revision)}
                  entityLabel="fleet"
                />
              </Collapse>

              <div className={actionBar}>
                <ShareButton shareable={shareable} />
                {!isTemplate && working.id !== null && (
                  <Tooltip label="View version history">
                    <Button
                      variant={historyOpen ? "filled" : "default"}
                      className={hardwareKey}
                      leftSection={<IconHistory size={16} />}
                      onClick={() => void openHistory()}
                    >
                      History
                    </Button>
                  </Tooltip>
                )}
                <Button
                  className={hardwareKey}
                  onClick={() => void save()}
                  disabled={shipCount === 0}
                  leftSection={<IconBucketDroplet size={16} />}
                >
                  {isTemplate ? "Save template" : "Save fleet"}
                </Button>
                {!isTemplate && (
                  <Button
                    component={Link}
                    to="/battle"
                    variant="light"
                    className={hardwareKey}
                    leftSection={<IconSwords size={16} />}
                    disabled={working.id === null}
                  >
                    Go to battle
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CassettePanel>

        {/* RIGHT COLUMN: ship browser + template library */}
        <div className={rightColumn}>
          <CassettePanel label="Ship Browser" className={splitWing}>
            <div className={wingBody}>
              {factionDesigns.length === 0 ? (
                <Text size="sm" c="dimmed">
                  {designs.length === 0 ? (
                    <>
                      No ships designed yet.{" "}
                      <Anchor component={Link} to="/ships" size="sm">
                        Open the ship designer
                      </Anchor>{" "}
                      to create some.
                    </>
                  ) : (
                    `No ${working.faction} ships designed yet.`
                  )}
                </Text>
              ) : (
                <ShipBrowser
                  designs={factionDesigns}
                  factionFilter={working.faction}
                  onSelect={addShip}
                  renderAction={() => undefined}
                />
              )}
            </div>
          </CassettePanel>
          <CassettePanel label="Formation Templates" className={splitWing}>
            <div className={wingBody}>
              <TemplateLibrary
                templates={templates}
                onInsert={insertTemplate}
                onEdit={loadTemplate}
                onDelete={(id) => void removeTemplate(id)}
                canInsert={true}
              />
            </div>
          </CassettePanel>
        </div>
      </div>

      <Modal
        opened={saveAsTpl !== null}
        onClose={() => setSaveAsTpl(null)}
        title="Save sub-formation as template"
        size="sm"
      >
        <Stack gap="xs">
          <TextInput
            label="Template name"
            placeholder="e.g. Escort screen"
            value={saveAsTpl?.name ?? ""}
            onChange={(e) =>
              setSaveAsTpl((prev) => (prev === null ? prev : { ...prev, name: e.target.value }))
            }
          />
          <Text size="xs" c="dimmed">
            The selected sub-formation and everything inside it is extracted into a reusable
            template. You can insert it into any fleet afterwards.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" className={hardwareKey} onClick={() => setSaveAsTpl(null)}>
              Cancel
            </Button>
            <Button className={hardwareKey} onClick={() => void confirmSaveAsTemplate()}>
              Save template
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}

/** Resolve a faction to its accent colour (fallback neutral). */
function paletteAccent(faction: string): string {
  return FACTION_PALETTE[faction]?.accent ?? "#9aa0a6";
}

/** Wrap the templates array as a lookup map for the spatial canvas. */
function templateMap(
  templates: FormationTemplate[] | undefined,
): ReadonlyMap<string, FormationTemplate> {
  const map = new Map<string, FormationTemplate>();
  for (const t of templates ?? []) map.set(t.id, t);
  return map;
}
