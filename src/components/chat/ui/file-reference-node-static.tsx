import type { SlateElementProps } from "platejs";

import { SlateElement } from "platejs";
import { File } from "lucide-react";

import type { TFileReferenceElement } from "../plugins/file-reference-plugin";

function formatDisplayName(name: string): string {
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}

function formatLineRange(lineStart?: number, lineEnd?: number): string {
  if (lineStart == null) return "";
  if (lineEnd != null && lineEnd !== lineStart)
    return `(${lineStart}:${lineEnd})`;
  return `(${lineStart})`;
}

export function FileReferenceElementStatic(
  props: SlateElementProps<TFileReferenceElement>,
) {
  const { element } = props;
  const name = formatDisplayName(element.displayName);
  const lineRange = formatLineRange(element.lineStart, element.lineEnd);

  return (
    <SlateElement {...props} className="inline">
      <span className="inline-flex items-center gap-1 bg-muted rounded-md px-1.5 py-0.5 text-xs text-foreground/80 border align-middle">
        <File className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="truncate max-w-40">{name}</span>
        {lineRange && (
          <span className="text-muted-foreground text-[10px]">{lineRange}</span>
        )}
      </span>
      {props.children}
    </SlateElement>
  );
}
