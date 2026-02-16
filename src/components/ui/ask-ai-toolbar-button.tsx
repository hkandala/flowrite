import { SparklesIcon } from "lucide-react";

import { Kbd } from "./kbd";
import { ToolbarButton } from "./toolbar";

export function AskAiToolbarButton() {
  return (
    <ToolbarButton
      onClick={() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "l",
            code: "KeyL",
            metaKey: true,
            bubbles: true,
          }),
        );
      }}
      data-plate-prevent-overlay
      tooltip={
        <>
          ask ai <Kbd>⌘L</Kbd>
        </>
      }
    >
      <SparklesIcon />
    </ToolbarButton>
  );
}
