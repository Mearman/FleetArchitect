import { Alert, Button, Stack, Text } from "@mantine/core";
import { useRouteError } from "react-router-dom";

/**
 * Error element rendered by react-router when a route loader or action throws.
 * Separate from the class ErrorBoundary (which catches render errors); this
 * handles thrown errors surfaced through the router's error boundary mechanism.
 */
export function RouteErrorPage() {
  const error = useRouteError();
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "An unexpected navigation error occurred.";

  return (
    <Stack p="xl" align="center" gap="md" maw={560} mx="auto" mt="xl">
      <Alert color="red" title="Page error" variant="filled" w="100%">
        <Text size="sm">{message}</Text>
      </Alert>
      <Button onClick={() => window.location.reload()}>Reload page</Button>
    </Stack>
  );
}
