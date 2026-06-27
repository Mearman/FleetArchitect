import {
  Alert,
  Button,
  Card,
  Center,
  Loader,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertTriangle, IconCircleCheck } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { saveFleet, saveFormationTemplate, saveShipDesign, storage } from "@/storage/db";
import { ShareDecodeError, decodeShareable } from "@/sharing/data-url";
import type { Shareable } from "@/sharing/data-url";
import { contentRouteScroll } from "./contentRoute.css";

type Status =
  | { state: "decoding" }
  | { state: "saved"; kind: Shareable["kind"]; name: string }
  | { state: "error"; message: string };

export function ImportRoute() {
  const { payload } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>({ state: "decoding" });

  useEffect(() => {
    let cancelled = false;

    // The payload is untrusted input from a URL, so a malformed link is an
    // expected, user-facing failure — decode and surface it rather than crash.
    void (async () => {
      if (payload === undefined) {
        if (!cancelled) {
          setStatus({ state: "error", message: "No share data found in the link." });
        }
        return;
      }

      let shareable: Shareable;
      try {
        shareable = decodeShareable(payload);
      } catch (error) {
        if (!cancelled) {
          setStatus({
            state: "error",
            message:
              error instanceof ShareDecodeError
                ? error.message
                : "The share link is malformed.",
          });
        }
        return;
      }

      // A battle isn't stored — it's replayed by the battle route, which owns
      // the /battle/<payload> URL. Forward the link there.
      if (shareable.kind === "battle") {
        if (!cancelled) await navigate(`/battle/${payload}`, { replace: true });
        return;
      }

      let savedName: string;
      if (shareable.kind === "shipDesign") {
        await saveShipDesign(shareable.value);
        savedName = shareable.value.name;
      } else if (shareable.kind === "formationTemplate") {
        await saveFormationTemplate(shareable.value);
        savedName = shareable.value.name;
      } else {
        // A fleet share bundles every formation template its tree references;
        // upsert them by id FIRST so the fleet's `template` nodes resolve on
        // resolve. Plain puts (not saveFormationTemplate) so re-importing a
        // link is idempotent — bundled templates are dependencies, not primary
        // imports, and a re-import must not churn the recipient's collection.
        for (const template of shareable.value.templates) {
          await storage().formationTemplates.save(template);
        }
        await saveFleet(shareable.value.fleet);
        savedName = shareable.value.fleet.name;
      }
      if (!cancelled) {
        setStatus({ state: "saved", kind: shareable.kind, name: savedName });
        notifications.show({
          title: "Imported",
          message: `${savedName} added to your collection.`,
          color: "teal",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [payload, navigate]);

  if (status.state === "decoding") {
    return (
      <div className={contentRouteScroll}>
        <Center h="100%">
          <Stack align="center" gap="sm">
            <Loader />
            <Text c="dimmed">Decoding share link…</Text>
          </Stack>
        </Center>
      </div>
    );
  }

  if (status.state === "error") {
    return (
      <div className={contentRouteScroll}>
        <Center h="100%" p="md">
          <Stack gap="md" maw={560}>
            <Title order={2}>Import failed</Title>
            <Alert
              icon={<IconAlertTriangle size={16} />}
              color="red"
              variant="light"
              title="Couldn't read this link"
            >
              {status.message}
            </Alert>
            <Button variant="light" onClick={() => { void navigate("/"); }}>
              Back to home
            </Button>
          </Stack>
        </Center>
      </div>
    );
  }

  const destination = status.kind === "shipDesign" ? "/ships" : "/fleets";
  const destinationLabel =
    status.kind === "shipDesign" ? "Ship Designer" : "Fleet Builder";

  return (
    <div className={contentRouteScroll}>
      <Center h="100%">
        <Card withBorder padding="xl" maw={480}>
          <Stack align="center" gap="sm">
            <IconCircleCheck size={40} color="#51cf66" />
            <Title order={3}>Imported {status.name}</Title>
            <Text size="sm" c="dimmed" ta="center">
              Saved to your browser. Open the {destinationLabel} to use it.
            </Text>
            <Button mt="xs" onClick={() => { void navigate(destination); }}>
              Open {destinationLabel}
            </Button>
          </Stack>
        </Card>
      </Center>
    </div>
  );
}
