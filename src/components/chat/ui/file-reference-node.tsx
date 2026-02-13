import type { PlateElementProps } from "platejs/react";

import { PlateElement } from "platejs/react";
import { File } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import type { TFileReferenceElement } from "../plugins/file-reference-plugin";
import { openFileFromAbsolutePath } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/workspace-store";

function formatDisplayName(name: string): string {
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}

function formatLineRange(lineStart?: number, lineEnd?: number): string {
  if (lineStart == null) return "";
  if (lineEnd != null && lineEnd !== lineStart)
    return `(${lineStart}:${lineEnd})`;
  return `(${lineStart})`;
}

export function FileReferenceElement(
  props: PlateElementProps<TFileReferenceElement>,
) {
  const { element } = props;
  const name = formatDisplayName(element.displayName);
  const lineRange = formatLineRange(element.lineStart, element.lineEnd);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await invoke<string>("read_external_file", { path: element.filePath });
      const { openFile, openExternalFile } = useWorkspaceStore.getState();
      openFileFromAbsolutePath(element.filePath, openFile, openExternalFile);
    } catch {
      toast.error("file doesn't exist");
    }
  };

  return (
    <PlateElement
      {...props}
      className="inline"
      attributes={{
        ...props.attributes,
        contentEditable: false,
      }}
    >
      <span
        role="button"
        tabIndex={-1}
        onClick={handleClick}
        className="inline-flex items-center gap-1 bg-muted rounded-md px-1.5 py-0.5 text-xs text-foreground/80 border align-middle cursor-pointer hover:bg-muted/80 transition-colors"
      >
        <File className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="truncate max-w-40">{name}</span>
        {lineRange && (
          <span className="text-muted-foreground text-[10px]">{lineRange}</span>
        )}
      </span>
      {props.children}
    </PlateElement>
  );
}
