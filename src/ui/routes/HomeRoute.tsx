import {
  Alert,
  Anchor,
  Card,
  Container,
  Grid,
  Group,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconArrowRight } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { cassettePanel, panelLabel } from "@/ui/components/panel.css";

const features = [
  {
    to: "/ships",
    title: "Design ships",
    body: "Build a ship cell by cell on a tile grid: lay hull tiles, then place weapons, shields, armour, engines and power. Balance mass, power and crew against the build budget.",
  },
  {
    to: "/fleets",
    title: "Architect fleets",
    body: "Compose your ships into a fleet within the point budget, then set each ship's formation, engagement range and target priority.",
  },
  {
    to: "/battle",
    title: "Watch the battle",
    body: "Two fleets clash under your pre-set orders. The result is deterministic, so the same fleets and seed always play out the same way.",
  },
];

export function HomeRoute() {
  return (
    <Container size="xl" py="lg">
      <Stack gap="xl">
        <Stack gap="xs">
          <Title order={1} style={{ fontFamily: "'Chakra Petch', sans-serif" }}>Fleet Architect</Title>
          <Text size="lg" c="dimmed" maw={720}>
            A browser-based reimagining of Gratuitous Space Battles. You don't fly
            the ships — you design them, set their orders, and then watch the
            whole gratuitous space battle unfold on its own.
          </Text>
        </Stack>

        <div className={cassettePanel}>
          <Alert variant="light" color="indigo" title="How to play">
            Design individual ships, compose them into a fleet with a doctrine, then
            send that fleet into battle. Wins come from the build and the plan, not
            from twitch reflexes.
          </Alert>
        </div>

        <Grid>
          {features.map((feature) => (
            <Grid.Col key={feature.to} span={{ base: 12, md: 4 }}>
              <Anchor component={Link} to={feature.to} underline="never">
                <Card h="100%" shadow="sm" padding="lg" radius="md" withBorder>
                  <Card.Section inheritPadding py={0} mb="xs">
                    <div className={panelLabel}>{feature.title}</div>
                  </Card.Section>
                  <Stack gap="xs" h="100%">
                    <Text size="sm" c="dimmed">
                      {feature.body}
                    </Text>
                    <Group mt="auto">
                      <Text size="sm" fw={600} c="indigo.4">
                        Open <IconArrowRight size={14} aria-hidden />
                      </Text>
                    </Group>
                  </Stack>
                </Card>
              </Anchor>
            </Grid.Col>
          ))}
        </Grid>

        <Text size="xs" c="dimmed">
          Fleets and designs are saved in your browser (IndexedDB). Share them via
          a link.
        </Text>
      </Stack>
    </Container>
  );
}
