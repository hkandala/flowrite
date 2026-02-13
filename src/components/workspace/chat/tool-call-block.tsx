import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";

import { cn } from "@/lib/utils";
import { openFileFromAbsolutePath } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/workspace-store";
import type { ToolCall } from "@/store/agent-store";

interface ToolCallBlockProps {
  toolCall: ToolCall;
}

/** Extract a clean file name from a location path like "/a/b/file.md:0" */
const cleanLocation = (
  location: string,
): { name: string; line: string | null; fullPath: string } => {
  // Split off :lineNumber suffix
  const colonMatch = location.match(/^(.+?):(\d+(?::\d+)?)$/);
  const path = colonMatch ? colonMatch[1] : location;
  const linePart = colonMatch ? colonMatch[2] : null;

  const name = path.split("/").filter(Boolean).pop() || path;

  // ":0" means full file — don't show it
  const line = linePart && linePart !== "0" ? linePart : null;

  return { name: name.toLowerCase(), line, fullPath: path };
};

/** Verb forms: [present participle, past tense, infinitive] */
const VERB_FORMS: Record<string, [string, string, string]> = {
  read: ["reading", "read", "read"],
  edit: ["editing", "edited", "edit"],
  delete: ["deleting", "deleted", "delete"],
  search: ["searching", "searched", "search"],
  execute: ["running", "ran", "run"],
  fetch: ["fetching", "fetched", "fetch"],
  think: ["thinking", "thought", "think"],
  move: ["moving", "moved", "move"],
};

const getVerb = (
  kind: string,
  status: string,
): string => {
  const forms = VERB_FORMS[kind];
  if (!forms) {
    if (status === "completed") return "ran";
    if (status === "failed") return "failed to run";
    return "running";
  }
  if (status === "completed") return forms[1];
  if (status === "failed") return `failed to ${forms[2]}`;
  return forms[0];
};

const GENERIC_TITLES = [
  "read",
  "write",
  "edit",
  "delete",
  "search",
  "find",
  "execute",
  "run",
  "bash",
  "fetch",
  "think",
  "move",
  "tool",
  "list",
  "undefined",
  ".",
];

/** Strip wrapping literal quotes from a title: `"foo"` -> `foo` */
const stripQuotes = (s: string): string => s.replace(/^"(.*)"$/, "$1");

const deriveLabel = (
  toolCall: ToolCall,
): { verb: string; subject: string | null } => {
  const location = toolCall.locations?.[0];
  const loc = location ? cleanLocation(location) : null;
  const fileName = loc?.name || null;
  const lineRange = loc?.line ? `:${loc.line}` : "";

  const rawTitle = toolCall.title?.toLowerCase() || "";
  const title = stripQuotes(rawTitle);
  const isGeneric = GENERIC_TITLES.some((g) => title === g || title.startsWith(`${g} `)) || title === "";
  const verb = getVerb(toolCall.kind, toolCall.status);

  switch (toolCall.kind) {
    case "read": {
      const file = fileName || (!isGeneric && title) || "file";
      return { verb, subject: `${file}${lineRange}` };
    }
    case "edit": {
      const file = fileName || (!isGeneric && title) || "file";
      return { verb, subject: `${file}${lineRange}` };
    }
    case "delete": {
      const file = fileName || (!isGeneric && title) || "file";
      return { verb, subject: file };
    }
    case "search": {
      const query = !isGeneric && title ? title : null;
      return { verb, subject: query };
    }
    case "execute": {
      const cmd = !isGeneric && title ? title : "command";
      return { verb, subject: cmd };
    }
    case "fetch": {
      // If title contains "://" it's a URL — extract domain
      if (title.includes("://")) {
        try {
          const domain = new URL(title).hostname;
          return { verb, subject: domain };
        } catch {
          return { verb, subject: title };
        }
      }
      // If title is non-generic text (not a bare "Fetch"), treat as search query
      if (!isGeneric && title) {
        const searchVerb = getVerb("search", toolCall.status);
        return { verb: searchVerb, subject: title };
      }
      return { verb, subject: null };
    }
    case "think":
      return { verb, subject: null };
    case "move": {
      const file = fileName || (!isGeneric && title) || "file";
      return { verb, subject: file };
    }
    default: {
      const fallback = fileName || (!isGeneric && title) || null;
      return { verb, subject: fallback };
    }
  }
};

export function ToolCallBlock({ toolCall }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [diffExpanded, setDiffExpanded] = useState(false);
  const isActive =
    toolCall.status === "pending" || toolCall.status === "in_progress";
  const { verb, subject } = deriveLabel(toolCall);

  const hasDiff =
    toolCall.diffData?.newText != null &&
    (toolCall.kind === "edit" || toolCall.kind === "read");

  const hasDetails =
    (toolCall.locations && toolCall.locations.length > 0) ||
    toolCall.content ||
    hasDiff;

  // Determine if the subject is a clickable file
  const location = toolCall.locations?.[0];
  const loc = location ? cleanLocation(location) : null;
  const isClickableFile = loc !== null;

  const handleFileClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!loc) return;
    const { openFile } = useWorkspaceStore.getState();
    const { openExternalFile } = useWorkspaceStore.getState();
    openFileFromAbsolutePath(loc.fullPath, openFile, openExternalFile);
  };

  const diffMetadata = useMemo(() => {
    if (!hasDiff || !toolCall.diffData) return null;
    const filename =
      toolCall.diffData.path.split("/").pop() || toolCall.diffData.path;
    try {
      return parseDiffFromFile(
        { name: filename, contents: toolCall.diffData.oldText ?? "" },
        { name: filename, contents: toolCall.diffData.newText ?? "" },
      );
    } catch {
      return null;
    }
  }, [hasDiff, toolCall.diffData]);

  const label = subject ? `${verb} ${subject}` : verb;

  return (
    <div className="px-1.5">
      <button
        type="button"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors max-w-full overflow-hidden"
        onClick={() => hasDetails && setExpanded((value) => !value)}
      >
        <span
          className={cn(
            "font-medium text-sm truncate",
            isActive
              ? [
                  "bg-[linear-gradient(to_right,var(--muted-foreground)_40%,var(--foreground)_60%,var(--muted-foreground)_80%)]",
                  "bg-size-[200%_auto] bg-clip-text text-transparent",
                  "animate-[shimmer_4s_infinite_linear]",
                ]
              : "text-muted-foreground",
          )}
        >
          {isClickableFile && !isActive ? (
            <>
              {verb}{" "}
              <span
                role="link"
                tabIndex={0}
                className="underline decoration-muted-foreground/40 hover:decoration-foreground cursor-pointer"
                onClick={handleFileClick}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleFileClick(e as unknown as React.MouseEvent);
                }}
              >
                {subject}
              </span>
            </>
          ) : (
            label
          )}
        </span>
        {hasDetails && (
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 transition-transform",
              expanded && "rotate-90",
            )}
          />
        )}
      </button>
      {expanded && hasDetails && (
        <div className="pl-1 pt-1.5 space-y-1.5">
          {toolCall.locations && toolCall.locations.length > 0 && (
            <div className="space-y-0.5">
              {toolCall.locations.map((locationItem) => (
                <div
                  key={locationItem}
                  className="text-xs text-muted-foreground font-mono truncate lowercase"
                >
                  {locationItem}
                </div>
              ))}
            </div>
          )}
          {diffMetadata && (
            <div
              className={cn(
                "rounded border border-border overflow-hidden",
                !diffExpanded && "max-h-[120px]",
              )}
            >
              <FileDiff
                fileDiff={diffMetadata}
                options={{
                  diffStyle: "unified",
                  lineDiffType: "word",
                  theme: "pierre-dark",
                  disableFileHeader: true,
                  disableLineNumbers: true,
                }}
              />
              {!diffExpanded && (
                <button
                  type="button"
                  className="w-full text-xs text-muted-foreground hover:text-foreground bg-muted/50 py-0.5 text-center"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDiffExpanded(true);
                  }}
                >
                  show full diff
                </button>
              )}
            </div>
          )}
          {toolCall.content && !hasDiff && (
            <pre className="text-xs text-muted-foreground overflow-x-auto lowercase">
              {toolCall.content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
