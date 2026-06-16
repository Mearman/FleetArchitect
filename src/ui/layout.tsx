import { Anchor, AppShell, Badge, Container, Group, Text } from "@mantine/core";
import { Link, Outlet } from "react-router-dom";
import { appShell } from "./theme.css";

const navItems = [
  { to: "/", label: "Home" },
  { to: "/ships", label: "Ships" },
  { to: "/fleets", label: "Fleets" },
  { to: "/battle", label: "Battle" },
];

export function AppLayout() {
  return (
    <AppShell className={appShell} header={{ height: 56 }} padding={0}>
      <AppShell.Header>
        <Group h={56} px="md" justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <Text fw={700} size="lg" c="indigo.3">
              Fleet Architect
            </Text>
            <Badge size="xs" variant="light" color="gray">
              alpha
            </Badge>
          </Group>
          <Group gap="lg" wrap="nowrap">
            {navItems.map((item) => (
              <Anchor
                key={item.to}
                component={Link}
                to={item.to}
                size="sm"
                fw={500}
              >
                {item.label}
              </Anchor>
            ))}
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Container size="xl" py="lg">
          <Outlet />
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
