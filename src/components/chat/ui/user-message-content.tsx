import { File } from "lucide-react";
import { useMemo, Fragment } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import { openFileFromAbsolutePath } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/workspace-store";

// Matches [@displayName#Lx:y](file:///path#Lx:y)
const FILE_REF_REGEX =
  /\[@([^#\]]+)(?:#L(\d+)(?::(\d+))?)?]\(file:\/\/([^)]+)\)/g;

interface FileRefMatch {
  displayName: string;
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
}

function formatDisplayName(name: string): string {
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}

function formatLineRange(lineStart?: number, lineEnd?: number): string {
  if (lineStart == null) return "";
  if (lineEnd != null && lineEnd !== lineStart)
    return `(${lineStart}:${lineEnd})`;
  return `(${lineStart})`;
}

function parseUserMessage(
  content: string,
): Array<
  { type: "text"; value: string } | { type: "file_ref"; data: FileRefMatch }
> {
  const parts: Array<
    { type: "text"; value: string } | { type: "file_ref"; data: FileRefMatch }
  > = [];

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  FILE_REF_REGEX.lastIndex = 0;

  while ((match = FILE_REF_REGEX.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: "text",
        value: content.slice(lastIndex, match.index),
      });
    }

    // extract file path, stripping line range fragment if present
    let filePath = match[4];
    const hashIdx = filePath.indexOf("#");
    if (hashIdx !== -1) filePath = filePath.slice(0, hashIdx);

    parts.push({
      type: "file_ref",
      data: {
        displayName: match[1],
        filePath,
        lineStart: match[2] ? Number(match[2]) : undefined,
        lineEnd: match[3] ? Number(match[3]) : undefined,
      },
    });

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push({ type: "text", value: content.slice(lastIndex) });
  }

  return parts;
}

function FileReferenceChip({ data }: { data: FileRefMatch }) {
  const name = formatDisplayName(data.displayName);
  const lineRange = formatLineRange(data.lineStart, data.lineEnd);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await invoke<string>("read_external_file", { path: data.filePath });
      const { openFile, openExternalFile } = useWorkspaceStore.getState();
      openFileFromAbsolutePath(data.filePath, openFile, openExternalFile);
    } catch {
      toast.error("file doesn't exist");
    }
  };

  return (
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
  );
}

export function UserMessageContent({ content }: { content: string }) {
  const parts = useMemo(() => parseUserMessage(content), [content]);

  if (parts.length === 1 && parts[0].type === "text") {
    return <>{content}</>;
  }

  return (
    <>
      {parts.map((part, i) =>
        part.type === "text" ? (
          <Fragment key={i}>{part.value}</Fragment>
        ) : (
          <FileReferenceChip key={i} data={part.data} />
        ),
      )}
    </>
  );
}
