import { Alert, Button, Stack, Text, Title } from "@mantine/core";
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Class-based error boundary that catches render errors in its subtree and
 * renders a friendly recovery screen. React requires class components for
 * `getDerivedStateFromError` — there is no hook equivalent.
 */
export class ErrorBoundary extends Component<Props, State> {
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface the error to the console so it appears in dev tools even when
    // the UI is recovered.
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  override state: State = { error: null };

  override render() {
    if (this.state.error !== null) {
      return (
        <Stack p="xl" align="center" gap="md" maw={560} mx="auto" mt="xl">
          <Alert color="red" title="Something went wrong" variant="filled" w="100%">
            <Text size="sm">
              An unexpected error occurred. You can try reloading the page — your
              designs and fleets are stored locally and will not be lost.
            </Text>
          </Alert>
          <Title order={3} c="dimmed" ta="center">
            {this.state.error.message}
          </Title>
          <Button onClick={() => window.location.reload()}>Reload page</Button>
        </Stack>
      );
    }
    return this.props.children;
  }
}
