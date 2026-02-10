import * as React from "react";

import {
  TablePlugin,
  TableProvider,
  useTableCellElement,
  useTableElement,
} from "@platejs/table/react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  type TTableCellElement,
  type TTableElement,
  type TTableRowElement,
} from "platejs";
import {
  type PlateElementProps,
  PlateElement,
  useComposedRef,
  useEditorPlugin,
  useEditorSelector,
  useElement,
  useFocusedLast,
  useReadOnly,
  useRemoveNodeButton,
  useSelected,
  withHOC,
} from "platejs/react";

import { cn } from "@/lib/utils";

import { Toolbar, ToolbarButton, ToolbarGroup } from "./toolbar";
export const TableElement = withHOC(
  TableProvider,
  function TableElement({
    children,
    ...props
  }: PlateElementProps<TTableElement>) {
    const readOnly = useReadOnly();
    const {
      isSelectingCell,
      marginLeft,
      props: tableProps,
    } = useTableElement();

    return (
      <PlateElement
        {...props}
        className={cn("py-5")}
        style={{ paddingLeft: marginLeft }}
      >
        <div className="group/table relative w-full">
          <div className="overflow-x-auto">
            <table
              className={cn(
                "h-px w-full border-collapse",
                isSelectingCell && "selection:bg-transparent",
              )}
              {...tableProps}
            >
              <tbody className="min-w-full">{children}</tbody>
            </table>
          </div>

          {!readOnly && <TableInlineToolbar />}
        </div>
      </PlateElement>
    );
  },
);

function TableInlineToolbar() {
  const { tf } = useEditorPlugin(TablePlugin);
  const selected = useSelected();
  const element = useElement<TTableElement>();
  const { props: buttonProps } = useRemoveNodeButton({ element });
  const collapsedInside = useEditorSelector(
    (editor) => selected && editor.api.isCollapsed(),
    [selected],
  );
  const isFocusedLast = useFocusedLast();

  if (!isFocusedLast || !collapsedInside) return null;

  return (
    <div
      className="absolute left-1/2 z-50 mt-1 -translate-x-1/2"
      contentEditable={false}
    >
      <Toolbar
        className="scrollbar-hide flex w-auto max-w-[80vw] flex-row overflow-x-auto rounded-md border bg-popover p-1 shadow-md print:hidden"
        contentEditable={false}
      >
        <ToolbarGroup>
          <ToolbarButton title="delete table" {...buttonProps}>
            <Trash2Icon />
          </ToolbarButton>
        </ToolbarGroup>

        <ToolbarGroup>
          <ToolbarButton
            onClick={() => {
              tf.insert.tableRow({ before: true });
            }}
            onMouseDown={(e) => e.preventDefault()}
            title="insert row before"
          >
            <ArrowUp />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => {
              tf.insert.tableRow();
            }}
            onMouseDown={(e) => e.preventDefault()}
            title="insert row after"
          >
            <ArrowDown />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => {
              tf.remove.tableRow();
            }}
            onMouseDown={(e) => e.preventDefault()}
            title="delete row"
          >
            <XIcon />
          </ToolbarButton>
        </ToolbarGroup>

        <ToolbarGroup>
          <ToolbarButton
            onClick={() => {
              tf.insert.tableColumn({ before: true });
            }}
            onMouseDown={(e) => e.preventDefault()}
            title="insert column before"
          >
            <ArrowLeft />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => {
              tf.insert.tableColumn();
            }}
            onMouseDown={(e) => e.preventDefault()}
            title="insert column after"
          >
            <ArrowRight />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => {
              tf.remove.tableColumn();
            }}
            onMouseDown={(e) => e.preventDefault()}
            title="delete column"
          >
            <XIcon />
          </ToolbarButton>
        </ToolbarGroup>
      </Toolbar>
    </div>
  );
}

export function TableRowElement({
  children,
  ...props
}: PlateElementProps<TTableRowElement>) {
  const selected = useSelected();
  return (
    <PlateElement
      {...props}
      ref={useComposedRef(props.ref)}
      as="tr"
      className={cn("group/row")}
      attributes={{
        ...props.attributes,
        "data-selected": selected ? "true" : undefined,
      }}
    >
      {children}
    </PlateElement>
  );
}

export function TableCellElement({
  isHeader,
  ...props
}: PlateElementProps<TTableCellElement> & {
  isHeader?: boolean;
}) {
  const { api } = useEditorPlugin(TablePlugin);
  const element = props.element;

  const { borders, minHeight, selected, width } = useTableCellElement();

  return (
    <PlateElement
      {...props}
      as={isHeader ? "th" : "td"}
      className={cn(
        "h-full overflow-visible border-none p-0",
        element.background && "bg-(--cellBackground)",
        isHeader && "text-left *:m-0",
        "before:size-full",
        selected && "before:z-10 before:bg-brand/5",
        "before:absolute before:box-border before:select-none before:content-['']",
        borders.bottom?.size && "before:border-b before:border-b-border",
        borders.right?.size && "before:border-r before:border-r-border",
        borders.left?.size && "before:border-l before:border-l-border",
        borders.top?.size && "before:border-t before:border-t-border",
      )}
      style={
        {
          "--cellBackground": element.background,
          width: width || undefined,
        } as React.CSSProperties
      }
      attributes={{
        ...props.attributes,
        colSpan: api.table.getColSpan(element),
        rowSpan: api.table.getRowSpan(element),
      }}
    >
      <div
        className="relative z-20 box-border h-full px-3 py-2"
        style={{ minHeight }}
      >
        {props.children}
      </div>
    </PlateElement>
  );
}

export function TableCellHeaderElement(
  props: React.ComponentProps<typeof TableCellElement>,
) {
  return <TableCellElement {...props} isHeader />;
}
