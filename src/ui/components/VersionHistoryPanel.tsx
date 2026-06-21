import {
  Button,
  Divider,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconArrowBackUp } from "@tabler/icons-react";

/** A single archived revision — the subset VersionHistoryPanel needs to render. */
interface RevisionEntry {
  revision: number;
  updatedAt: string;
}

interface VersionHistoryPanelProps {
  loading: boolean;
  revisions: RevisionEntry[];
  onRestore: (revision: number) => void;
  /** Describes the entity type in the "rolls back the…" footer text. */
  entityLabel: string;
}

/**
 * Collapsible version history panel shared by the Ship Designer and Fleet
 * Builder. Renders a list of archived revision snapshots with restore buttons.
 * The parent is responsible for fetching revisions and wiring `onRestore`.
 */
export function VersionHistoryPanel({
  loading,
  revisions,
  onRestore,
  entityLabel,
}: VersionHistoryPanelProps) {
  return (
    <Paper p="md" withBorder>
      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={600} size="sm">
            Version history
          </Text>
          {loading ? <Loader size="xs" /> : null}
        </Group>
        {!loading && revisions.length === 0 ? (
          <Text size="sm" c="dimmed">
            No history yet — prior versions appear here after each save.
          </Text>
        ) : null}
        {revisions.map((rev) => (
          <Group key={rev.revision} justify="space-between" wrap="nowrap">
            <Stack gap={0}>
              <Text size="sm">Revision {rev.revision}</Text>
              <Text size="xs" c="dimmed">
                {new Date(rev.updatedAt).toLocaleString()}
              </Text>
            </Stack>
            <Tooltip label="Restore this revision">
              <Button
                size="xs"
                variant="light"
                color="orange"
                leftSection={<IconArrowBackUp size={14} />}
                onClick={() => onRestore(rev.revision)}
              >
                Restore
              </Button>
            </Tooltip>
          </Group>
        ))}
        {revisions.length > 0 ? (
          <>
            <Divider />
            <Text size="xs" c="dimmed">
              Restoring archives the current version and rolls back the{" "}
              {entityLabel}.
            </Text>
          </>
        ) : null}
      </Stack>
    </Paper>
  );
}
