import * as React from "react";

import type { PlateEditor, PlateElementProps } from "platejs/react";

import {
  CalendarIcon,
  ChevronRightIcon,
  Code2,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ListIcon,
  ListOrdered,
  PilcrowIcon,
  Quote,
  Square,
  Table,
} from "lucide-react";
import { type TComboboxInputElement, KEYS } from "platejs";
import { PlateElement } from "platejs/react";

import {
  insertBlock,
  insertInlineElement,
} from "@/components/editor/transforms";

import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxGroupLabel,
  InlineComboboxInput,
  InlineComboboxItem,
} from "./inline-combobox";

type Group = {
  group: string;
  items: {
    icon: React.ReactNode;
    value: string;
    onSelect: (editor: PlateEditor, value: string) => void;
    className?: string;
    focusEditor?: boolean;
    keywords?: string[];
    label?: string;
  }[];
};

const groups: Group[] = [
  {
    group: "basic blocks",
    items: [
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
        value: KEYS.h1,
      },
      {
        icon: <Heading2Icon />,
        keywords: ["subtitle", "h2"],
        label: "heading 2",
        value: KEYS.h2,
      },
      {
        icon: <Heading3Icon />,
        keywords: ["subtitle", "h3"],
        label: "heading 3",
        value: KEYS.h3,
      },
      {
        icon: <ListIcon />,
        keywords: ["unordered", "ul", "-"],
        label: "bulleted list",
        value: KEYS.ul,
      },
      {
        icon: <ListOrdered />,
        keywords: ["ordered", "ol", "1"],
        label: "numbered list",
        value: KEYS.ol,
      },
      {
        icon: <Square />,
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
        icon: <Quote />,
        keywords: ["citation", "blockquote", "quote", ">"],
        label: "blockquote",
        value: KEYS.blockquote,
      },
      {
        icon: <Table />,
        label: "table",
        value: KEYS.table,
      },
      {
        icon: <Code2 />,
        keywords: ["```"],
        label: "code block",
        value: KEYS.codeBlock,
      },
    ].map((item) => ({
      ...item,
      onSelect: (editor, value) => {
        insertBlock(editor, value);
      },
    })),
  },
  {
    group: "inline",
    items: [
      {
        focusEditor: true,
        icon: <CalendarIcon />,
        keywords: ["time"],
        label: "date",
        value: KEYS.date,
      },
    ].map((item) => ({
      ...item,
      onSelect: (editor, value) => {
        insertInlineElement(editor, value);
      },
    })),
  },
];

export function SlashInputElement(
  props: PlateElementProps<TComboboxInputElement>,
) {
  const { editor, element } = props;

  return (
    <PlateElement {...props} as="span">
      <InlineCombobox element={element} trigger="/">
        <InlineComboboxInput />

        <InlineComboboxContent>
          <InlineComboboxEmpty>no results</InlineComboboxEmpty>

          {groups.map(({ group, items }) => (
            <InlineComboboxGroup key={group}>
              <InlineComboboxGroupLabel>{group}</InlineComboboxGroupLabel>

              {items.map(
                ({ focusEditor, icon, keywords, label, value, onSelect }) => (
                  <InlineComboboxItem
                    key={value}
                    value={value}
                    onClick={() => onSelect(editor, value)}
                    label={label}
                    focusEditor={focusEditor}
                    group={group}
                    keywords={keywords}
                  >
                    <div className="mr-2 text-muted-foreground">{icon}</div>
                    {label ?? value}
                  </InlineComboboxItem>
                ),
              )}
            </InlineComboboxGroup>
          ))}
        </InlineComboboxContent>
      </InlineCombobox>

      {props.children}
    </PlateElement>
  );
}
