import * as React from "react";

import type { DropdownMenuProps } from "@radix-ui/react-dropdown-menu";
import type { TElement } from "platejs";

import { DropdownMenuItemIndicator } from "@radix-ui/react-dropdown-menu";
import {
  CheckIcon,
  ChevronRightIcon,
  FileCodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ListIcon,
  ListOrderedIcon,
  PilcrowIcon,
  QuoteIcon,
  SquareIcon,
} from "lucide-react";
import { KEYS } from "platejs";
import { useEditorRef, useSelectionFragmentProp } from "platejs/react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getBlockType, setBlockType } from "@/components/editor/transforms";

import { ToolbarButton, ToolbarMenuGroup } from "./toolbar";

export const turnIntoItems = [
  {
    icon: <PilcrowIcon />,
    keywords: ["paragraph"],
    label: "text",
    value: KEYS.p,
  },
  {
    icon: <Heading1Icon />,
    keywords: ["title", "h1"],
    label: "heading 1",
    value: "h1",
  },
  {
    icon: <Heading2Icon />,
    keywords: ["subtitle", "h2"],
    label: "heading 2",
    value: "h2",
  },
  {
    icon: <Heading3Icon />,
    keywords: ["subtitle", "h3"],
    label: "heading 3",
    value: "h3",
  },
  {
    icon: <ListIcon />,
    keywords: ["unordered", "ul", "-"],
    label: "bulleted list",
    value: KEYS.ul,
  },
  {
    icon: <ListOrderedIcon />,
    keywords: ["ordered", "ol", "1"],
    label: "numbered list",
    value: KEYS.ol,
  },
  {
    icon: <SquareIcon />,
    keywords: ["checklist", "task", "checkbox", "[]"],
    label: "to-do list",
    value: KEYS.listTodo,
  },
  {
    icon: <ChevronRightIcon />,
    keywords: ["collapsible", "expandable"],
    label: "toggle list",
    value: KEYS.toggle,
  },
  {
    icon: <QuoteIcon />,
    keywords: ["citation", "blockquote", ">"],
    label: "quote",
    value: KEYS.blockquote,
  },
  {
    icon: <FileCodeIcon />,
    keywords: ["```"],
    label: "code",
    value: KEYS.codeBlock,
  },
];

export function TurnIntoToolbarButton(props: DropdownMenuProps) {
  const editor = useEditorRef();
  const [open, setOpen] = React.useState(false);

  const value = useSelectionFragmentProp({
    defaultValue: KEYS.p,
    getProp: (node) => getBlockType(node as TElement),
  });
  const selectedItem = React.useMemo(
    () =>
      turnIntoItems.find((item) => item.value === (value ?? KEYS.p)) ??
      turnIntoItems[0],
    [value],
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false} {...props}>
      <DropdownMenuTrigger asChild>
        <ToolbarButton
          className="min-w-31.25"
          pressed={open}
          tooltip="turn into"
          isDropdown
        >
          {selectedItem.label}
        </ToolbarButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className="ignore-click-outside/toolbar min-w-0"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          editor.tf.focus();
        }}
        align="start"
      >
        <ToolbarMenuGroup
          value={value}
          onValueChange={(type) => {
            setBlockType(editor, type);
          }}
          label="turn into"
        >
          {turnIntoItems.map(({ icon, label, value: itemValue }) => (
            <DropdownMenuRadioItem
              key={itemValue}
              className="min-w-45 pl-2 *:first:[span]:hidden"
              value={itemValue}
            >
              <span className="pointer-events-none absolute right-2 flex size-3.5 items-center justify-center">
                <DropdownMenuItemIndicator>
                  <CheckIcon />
                </DropdownMenuItemIndicator>
              </span>
              {icon}
              {label}
            </DropdownMenuRadioItem>
          ))}
        </ToolbarMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
