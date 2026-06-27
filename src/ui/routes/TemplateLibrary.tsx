/**
 * The formation-template library wing. Lists stored {@link FormationTemplate}s
 * with insert-by-reference (adds a `template` node to the focused formation),
 * edit (loads the template's formation into the tree editor), and delete. A
 * referenced-but-missing template surfaces as a badge in the tree itself; here
 * we list only stored templates.
 *
 * "Save subtree as template" is triggered from a formation node card (the route
 * owns the naming modal and the extraction). This wing is the catalogue: browse,
 * insert, edit, delete.
 */

import { ActionIcon, Anchor, Text, Tooltip } from "@mantine/core";
import {
  IconArrowMoveRight,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { flattenShipLeaves } from "@/schema/formation";
import type { FormationTemplate } from "@/schema/formation-template";
import { hardwareKeySmall } from "@/ui/theme/controls.css";
import {
  templateActions,
  templateCount,
  templateEmpty,
  templateFaction,
  templateHeader,
  templateName,
  templateRow,
} from "./TemplateLibrary.css";

interface TemplateLibraryProps {
  templates: FormationTemplate[] | undefined;
  /** Insert a template reference into the focused formation (fleet mode). */
  onInsert: (templateId: string) => void;
  /** Load a template into the tree editor for editing. */
  onEdit: (template: FormationTemplate) => void;
  /** Delete a stored template. */
  onDelete: (id: string) => void;
  /** Whether new templates can be inserted right now (fleet mode only). */
  canInsert: boolean;
}

export function TemplateLibrary({
  templates,
  onInsert,
  onEdit,
  onDelete,
  canInsert,
}: TemplateLibraryProps) {
  if (templates === undefined) {
    return (
      <div className={templateEmpty}>Loading templates…</div>
    );
  }
  if (templates.length === 0) {
    return (
      <div className={templateEmpty}>
        No formation templates yet. Build a sub-formation in the fleet editor and
        use <Text component="span" fw={600}>Save as template</Text> to add one.
      </div>
    );
  }
  return (
    <div>
      <div className={templateHeader}>
        <Text size="xs" c="dimmed" fw={600}>
          {templates.length} stored
        </Text>
        {!canInsert && (
          <Anchor component={Link} to="/ships" size="xs">
            Need a fleet first
          </Anchor>
        )}
      </div>
      {templates.map((t) => {
        const leafCount = flattenShipLeaves(t.formation).length;
        return (
          <div className={templateRow} key={t.id}>
            <span className={templateName}>{t.name}</span>
            <span className={templateFaction}>{t.faction}</span>
            <span className={templateCount}>{leafCount} ship{leafCount === 1 ? "" : "s"}</span>
            <span className={templateActions}>
              {canInsert && (
                <Tooltip label="Insert into focused formation" withArrow position="bottom" openDelay={200}>
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    className={hardwareKeySmall}
                    aria-label={`Insert template ${t.name}`}
                    onClick={() => onInsert(t.id)}
                  >
                    <IconArrowMoveRight size={12} />
                  </ActionIcon>
                </Tooltip>
              )}
              <Tooltip label="Edit template" withArrow position="bottom" openDelay={200}>
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  className={hardwareKeySmall}
                  aria-label={`Edit template ${t.name}`}
                  onClick={() => onEdit(t)}
                >
                  <IconPencil size={12} />
                </ActionIcon>
              </Tooltip>
              <ActionIcon
                size="xs"
                variant="subtle"
                color="red"
                aria-label={`Delete template ${t.name}`}
                disabled={t.source === "preset"}
                onClick={() => onDelete(t.id)}
              >
                <IconTrash size={12} />
              </ActionIcon>
            </span>
          </div>
        );
      })}
      <div className={templateHeader} style={{ marginTop: "0.3rem" }}>
        <IconPlus size={12} style={{ opacity: 0.5 }} />
        <Text size="xs" c="dimmed">
          Save a sub-formation as a template from the fleet editor.
        </Text>
      </div>
    </div>
  );
}
