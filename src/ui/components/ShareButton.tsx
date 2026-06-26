import { Button } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconShare } from "@tabler/icons-react";
import { buildShareUrl, encodeShareable } from "@/sharing/data-url";
import type { Shareable } from "@/sharing/data-url";

interface ShareButtonProps {
  shareable: Shareable;
  label?: string;
}

/**
 * Encodes a ship design or fleet into a shareable data URL and copies it to the
 * clipboard. Falls back to showing the link if the clipboard API is unavailable
 * (e.g. insecure context).
 */
export function ShareButton({ shareable, label = "Share" }: ShareButtonProps) {
  async function handleShare() {
    const url = buildShareUrl(encodeShareable(shareable));
    try {
      await navigator.clipboard.writeText(url);
      notifications.show({
        title: "Link copied",
        message: "Paste it anywhere — the whole design is encoded in the URL.",
        color: "indigo",
      });
    } catch {
      notifications.show({
        title: "Copy this link",
        message: url,
        color: "indigo",
        autoClose: false,
      });
    }
  }

  return (
    <Button
      variant="light"
      leftSection={<IconShare size={16} />}
      onClick={() => {
        void handleShare();
      }}
    >
      {label}
    </Button>
  );
}
