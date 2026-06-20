import {
  Anchor,
  AppShell,
  Badge,
  Box,
  Burger,
  Drawer,
  Group,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { NavLink, Outlet } from "react-router-dom";
import { appShell, navLinkActive, navLinkBase } from "./theme.css";
import { buildMeta } from "./buildMeta";
import { ErrorBoundary } from "./components/ErrorBoundary";

const navItems = [
  { to: "/", label: "Home" },
  { to: "/ships", label: "Ships" },
  { to: "/fleets", label: "Fleets" },
  { to: "/battle", label: "Battle" },
];

/**
 * Render a nav item using react-router's NavLink. When active, applies
 * a bolder, highlighted style and sets aria-current="page".
 */
function NavItem({ to, label, onClick }: { to: string; label: string; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        isActive ? `${navLinkBase} ${navLinkActive}` : navLinkBase
      }
      onClick={onClick}
    >
      {({ isActive }) => (
        <span aria-current={isActive ? "page" : undefined}>{label}</span>
      )}
    </NavLink>
  );
}

export function AppLayout() {
  const [drawerOpen, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);

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
            {buildMeta && (
              <Tooltip label={buildMeta.title} position="bottom" withArrow openDelay={200}>
                <Anchor
                  size="xs"
                  c="dimmed"
                  href={buildMeta.href}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {buildMeta.label}
                </Anchor>
              </Tooltip>
            )}
          </Group>

          {/* Desktop nav — hidden below sm */}
          <Box component="nav" aria-label="Main navigation" visibleFrom="sm">
            <Group gap="lg" wrap="nowrap">
              {navItems.map((item) => (
                <NavItem key={item.to} to={item.to} label={item.label} />
              ))}
            </Group>
          </Box>

          {/* Mobile burger — shown below sm */}
          <Burger
            opened={drawerOpen}
            onClick={drawerOpen ? closeDrawer : openDrawer}
            hiddenFrom="sm"
            size="sm"
            aria-label="Toggle navigation"
          />
        </Group>
      </AppShell.Header>

      {/* Mobile drawer nav */}
      <Drawer
        opened={drawerOpen}
        onClose={closeDrawer}
        title="Navigation"
        size="xs"
        hiddenFrom="sm"
        zIndex={200}
      >
        <Stack gap="sm" component="nav" aria-label="Mobile navigation">
          {navItems.map((item) => (
            <NavItem key={item.to} to={item.to} label={item.label} onClick={closeDrawer} />
          ))}
        </Stack>
      </Drawer>

      <AppShell.Main>
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </AppShell.Main>
    </AppShell>
  );
}
