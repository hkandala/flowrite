import React from "react";

import { cn } from "@/lib/utils";
import type { TListElement } from "platejs";

import { isOrderedList } from "@platejs/list";
import {
  useTodoListElement,
  useTodoListElementState,
} from "@platejs/list/react";
import {
  type PlateElementProps,
  type RenderNodeWrapper,
  useEditorRef,
  usePluginOption,
  useReadOnly,
} from "platejs/react";

import { Checkbox } from "@/components/ui/checkbox";
import { TodoViewPlugin } from "@/components/editor/plugins/todo-view-plugin";
import { moveToAdjacentBlock } from "@/components/editor/plugins/basic-blocks-kit";

const config: Record<
  string,
  {
    Li: React.FC<PlateElementProps>;
    Marker: React.FC<PlateElementProps>;
  }
> = {
  todo: {
    Li: TodoLi,
    Marker: TodoMarker,
  },
};

export const BlockList: RenderNodeWrapper = (props) => {
  if (!props.element.listStyleType) return;

  return (props) => <List {...props} />;
};

function List(props: PlateElementProps) {
  const { listStart, listStyleType } = props.element as TListElement;
  const { Li, Marker } = config[listStyleType] ?? {};
  const List = isOrderedList(props.element) ? "ol" : "ul";

  return (
    <List
      className="relative m-0 p-0"
      style={{ listStyleType }}
      start={listStart}
    >
      {Marker && <Marker {...props} />}
      {Li ? <Li {...props} /> : <li>{props.children}</li>}
    </List>
  );
}

function TodoMarker(props: PlateElementProps) {
  const editor = useEditorRef();
  const state = useTodoListElementState({ element: props.element });
  const { checkboxProps } = useTodoListElement(state);
  const readOnly = useReadOnly();
  const hideChecked = usePluginOption(TodoViewPlugin, "hideChecked");
  const isChecked = props.element.checked as boolean;

  // hide marker when hiding checked items
  if (hideChecked && isChecked) {
    return null;
  }

  // wrap onCheckedChange to move cursor when checking item with hideChecked enabled
  const handleCheckedChange = (checked: boolean) => {
    checkboxProps.onCheckedChange?.(checked);

    // if marking as checked and hideChecked is enabled, move to next/prev block
    if (checked && hideChecked) {
      setTimeout(() => {
        moveToAdjacentBlock(editor);
      }, 0);
    }
  };

  return (
    <div contentEditable={false}>
      <Checkbox
        className={cn(
          "absolute top-0.75 -left-6",
          readOnly && "pointer-events-none",
        )}
        {...checkboxProps}
        onCheckedChange={handleCheckedChange}
      />
    </div>
  );
}

function TodoLi(props: PlateElementProps) {
  const isChecked = props.element.checked as boolean;

  return (
    <li
      className={cn(
        "list-none transition-colors duration-200",
        isChecked && "text-muted-foreground",
      )}
    >
      {props.children}
    </li>
  );
}
