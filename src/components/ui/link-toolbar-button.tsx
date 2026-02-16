import * as React from "react";

import {
  useLinkToolbarButton,
  useLinkToolbarButtonState,
} from "@platejs/link/react";
import { Link } from "lucide-react";

import { Kbd } from "./kbd";
import { ToolbarButton } from "./toolbar";

export function LinkToolbarButton(
  props: React.ComponentProps<typeof ToolbarButton>,
) {
  const state = useLinkToolbarButtonState();
  const { props: buttonProps } = useLinkToolbarButton(state);

  return (
    <ToolbarButton
      {...props}
      {...buttonProps}
      data-plate-focus
      tooltip={<>link <Kbd>⌘K</Kbd></>}
    >
      <Link />
    </ToolbarButton>
  );
}
