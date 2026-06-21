import { SegmentedControl, Tooltip } from "@mantine/core";
import { useFx, type FxLevel } from "./FxContext";

const OPTIONS: { value: FxLevel; label: string }[] = [
  { value: "off",     label: "OFF" },
  { value: "reduced", label: "LOW" },
  { value: "full",    label: "CRT" },
];

/** Three-state CRT effects toggle for the app header. */
export function FxToggle() {
  const { userPref, setUserPref } = useFx();
  return (
    <Tooltip label="CRT effects level" position="bottom" withArrow openDelay={300}>
      <SegmentedControl
        size="xs"
        value={userPref}
        onChange={(v) => {
          if (v === "off" || v === "reduced" || v === "full") {
            setUserPref(v);
          }
        }}
        data={OPTIONS}
      />
    </Tooltip>
  );
}
