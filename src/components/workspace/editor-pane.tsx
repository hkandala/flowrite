import { useCallback, useEffect, useRef, useState } from "react";
import { IDockviewPanelProps } from "dockview";
import { Plate, createPlateEditor } from "platejs/react";
import {
  UnfoldHorizontal,
  FoldHorizontal,
  Maximize2,
  Minimize2,
  Loader2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import matter from "gray-matter";
import { MarkdownPlugin } from "@platejs/markdown";
import { getCommentKey } from "@platejs/comment";
import { nanoid, NodeApi } from "platejs";

import { cn, getBaseDir, isInternalPath } from "@/lib/utils";
import { Editor as PlateEditor, EditorContainer } from "@/components/ui/editor";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useWorkspaceStore,
  registerEditor,
  unregisterEditor,
} from "@/store/workspace-store";
import { BasicBlocksKit } from "@/components/editor/plugins/basic-blocks-kit";
import { BasicMarksKit } from "@/components/editor/plugins/basic-marks-kit";
import { LinkKit } from "@/components/editor/plugins/link-kit";
import { ListKit } from "@/components/editor/plugins/list-kit";
import { CodeBlockKit } from "@/components/editor/plugins/code-block-kit";
import { TableKit } from "../editor/plugins/table-kit";
import { EmojiKit } from "../editor/plugins/emoji-kit";
import { DateKit } from "../editor/plugins/date-kit";
import { ToggleKit } from "../editor/plugins/toggle-kit";
import { MarkdownKit } from "@/components/editor/plugins/markdown-kit";
import { AutoformatKit } from "@/components/editor/plugins/autoformat-kit";
import { ExitBreakKit } from "@/components/editor/plugins/exit-break-kit";
import { SlashKit } from "../editor/plugins/slash-kit";
import { FloatingToolbarKit } from "../editor/plugins/floating-toolbar-kit";
import { CommentKit } from "../editor/plugins/comment-kit";
import {
  DiscussionKit,
  discussionPlugin,
  type TDiscussion,
} from "../editor/plugins/discussion-kit";
import type { TComment } from "@/components/ui/comment";
import { useDiffStore } from "@/store/diff-store";
import { DiffOverlay } from "@/components/workspace/diff-overlay";

const BUTTON_TIMEOUT = 1500;
const SCROLL_DEBOUNCE = 300;

/** Get the last element of an array (ES2020-safe alternative to .at(-1)) */
function lastElement<T>(arr: T[]): T | undefined {
  return arr[arr.length - 1];
}

// --- comment serialization/deserialization ---

interface SerializedComment {
  user: string;
  content: string;
  createdAt: string;
}

interface SerializedDiscussion {
  id: string;
  documentContent: string;
  createdAt: string;
  comments: SerializedComment[];
}

/** Extract plain text from a Slate Value (rich text). */
function richTextToPlain(value: unknown[]): string {
  return value.map((node) => NodeApi.string(node as any)).join("\n");
}

/**
 * Serialize discussions using inline HTML comment markers.
 * Returns YAML-ready data AND a cloned Slate tree with placeholders injected.
 * Placeholders are alphanumeric so the markdown serializer won't escape them.
 * Call `replaceMarkerPlaceholders()` on the serialized markdown to convert
 * placeholders to real `<!--id-->` / `<!--/id-->` markers.
 */
function serializeDiscussionsWithMarkers(
  editor: ReturnType<typeof createPlateEditor>,
  discussions: TDiscussion[],
): { serialized: SerializedDiscussion[]; markedValue: any[] } {
  const activeDiscussions = discussions.filter((d) => !d.isResolved);
  if (activeDiscussions.length === 0) {
    return { serialized: [], markedValue: structuredClone(editor.children) };
  }

  // Build posMap: discussionId → position range + document content
  const posMap = new Map<
    string,
    {
      startBlock: number;
      startOffset: number;
      endBlock: number;
      endOffset: number;
      docContent: string;
      lastSeenBlock: number;
    }
  >();

  const blocks = editor.children;

  for (let blockIdx = 0; blockIdx < blocks.length; blockIdx++) {
    const block = blocks[blockIdx];
    const textNodes = Array.from(NodeApi.texts(block as any));
    let charOffset = 0;

    for (const [textNode] of textNodes) {
      const text = (textNode as any).text as string;
      const keys = Object.keys(textNode).filter(
        (k) => k.startsWith("comment_") && k !== "comment_draft",
      );

      for (const key of keys) {
        const discussionId = key.replace("comment_", "");
        const existing = posMap.get(discussionId);
        if (!existing) {
          posMap.set(discussionId, {
            startBlock: blockIdx,
            startOffset: charOffset,
            endBlock: blockIdx,
            endOffset: charOffset + text.length,
            docContent: text,
            lastSeenBlock: blockIdx,
          });
        } else {
          existing.endBlock = blockIdx;
          existing.endOffset = charOffset + text.length;
          if (existing.lastSeenBlock === blockIdx) {
            existing.docContent += text;
          } else {
            existing.docContent += "\n" + text;
            existing.lastSeenBlock = blockIdx;
          }
        }
      }

      charOffset += text.length;
    }
  }

  // Clone the Slate tree for marker injection
  const markedValue = structuredClone(editor.children) as any[];

  // Collect injection points
  const injections: {
    blockIdx: number;
    charOffset: number;
    type: "open" | "close";
    id: string;
  }[] = [];

  for (const [id, pos] of posMap) {
    injections.push({
      blockIdx: pos.startBlock,
      charOffset: pos.startOffset,
      type: "open",
      id,
    });
    injections.push({
      blockIdx: pos.endBlock,
      charOffset: pos.endOffset,
      type: "close",
      id,
    });
  }

  // Sort descending so we inject from end to start (preserves earlier offsets)
  injections.sort((a, b) => {
    if (a.blockIdx !== b.blockIdx) return b.blockIdx - a.blockIdx;
    if (a.charOffset !== b.charOffset) return b.charOffset - a.charOffset;
    // Close markers before open markers at same position (for interleaving)
    return a.type === "close" ? -1 : 1;
  });

  // Inject placeholders into cloned tree (alphanumeric to avoid escaping)
  for (const inj of injections) {
    const marker =
      inj.type === "open" ? `CMTO${inj.id}CMTE` : `CMTC${inj.id}CMTE`;
    const block = markedValue[inj.blockIdx];
    if (!block?.children) continue;

    // Find the text node at the target offset and split it
    let pos = 0;
    const newChildren: any[] = [];
    let injected = false;

    for (const child of block.children) {
      if (child.text === undefined || injected) {
        newChildren.push(child);
        continue;
      }

      const text: string = child.text;
      const nodeStart = pos;
      const nodeEnd = pos + text.length;

      if (inj.charOffset >= nodeStart && inj.charOffset <= nodeEnd) {
        const splitAt = inj.charOffset - nodeStart;
        // Strip comment marks from the parts
        const cleanProps = { ...child };
        for (const k of Object.keys(cleanProps)) {
          if (k.startsWith("comment_") || k === "comment") {
            delete cleanProps[k];
          }
        }

        if (splitAt > 0) {
          newChildren.push({ ...cleanProps, text: text.slice(0, splitAt) });
        }
        newChildren.push({ text: marker });
        if (splitAt < text.length) {
          newChildren.push({ ...cleanProps, text: text.slice(splitAt) });
        }
        injected = true;
      } else {
        // Strip comment marks from non-injection nodes too
        const cleanProps = { ...child };
        for (const k of Object.keys(cleanProps)) {
          if (k.startsWith("comment_") || k === "comment") {
            delete cleanProps[k];
          }
        }
        newChildren.push(cleanProps);
      }

      pos = nodeEnd;
    }

    // If offset is past all text nodes (e.g. end of block), append marker
    if (!injected) {
      newChildren.push({ text: marker });
    }

    block.children = newChildren;
  }

  // Build serialized discussions
  const serialized: SerializedDiscussion[] = [];

  for (const discussion of activeDiscussions) {
    const pos = posMap.get(discussion.id);
    serialized.push({
      id: discussion.id,
      documentContent: pos?.docContent ?? discussion.documentContent ?? "",
      createdAt: new Date(discussion.createdAt).toISOString(),
      comments: discussion.comments.map((c) => ({
        user: c.userId,
        content: richTextToPlain(c.contentRich),
        createdAt: new Date(c.createdAt).toISOString(),
      })),
    });
  }

  return { serialized, markedValue };
}

/** Replace alphanumeric placeholders with real HTML comment markers. */
function replaceMarkerPlaceholders(markdown: string): string {
  return markdown
    .replace(/CMTO([\w-]+?)CMTE/g, "<!--$1-->")
    .replace(/CMTC([\w-]+?)CMTE/g, "<!--/$1-->");
}

/**
 * Extract inline HTML comment markers from markdown and return clean markdown.
 */
function extractAndStripMarkers(markdown: string): {
  cleanMarkdown: string;
  markers: Array<{ id: string; textContent: string }>;
} {
  const markerPattern = /<!--([\w-]+)-->/g;
  const openPositions = new Map<string, number>();
  const markers: Array<{ id: string; textContent: string }> = [];

  // First pass: find all open/close marker positions in original text
  const allMarkers: Array<{
    start: number;
    end: number;
    id: string;
    type: "open" | "close";
  }> = [];

  let match;
  while ((match = markerPattern.exec(markdown)) !== null) {
    const raw = match[1];
    if (raw.startsWith("/")) {
      allMarkers.push({
        start: match.index,
        end: match.index + match[0].length,
        id: raw.slice(1),
        type: "close",
      });
    } else {
      allMarkers.push({
        start: match.index,
        end: match.index + match[0].length,
        id: raw,
        type: "open",
      });
    }
  }

  // Pair open/close markers and extract text between them
  for (const m of allMarkers) {
    if (m.type === "open") {
      openPositions.set(m.id, m.end);
    } else if (m.type === "close" && openPositions.has(m.id)) {
      const textStart = openPositions.get(m.id)!;
      let textContent = markdown.slice(textStart, m.start);
      // Strip any nested markers from the extracted text
      textContent = textContent.replace(/<!--\/?[\w-]+-->/g, "");
      markers.push({ id: m.id, textContent });
      openPositions.delete(m.id);
    }
  }

  // Remove all markers from markdown
  const cleanMarkdown = markdown.replace(/<!--\/?[\w-]+-->/g, "");

  return { cleanMarkdown, markers };
}

/**
 * Deserialize frontmatter discussions using stable IDs (new marker format).
 */
function deserializeDiscussions(serialized: SerializedDiscussion[]): {
  discussions: TDiscussion[];
  users: Record<string, { id: string; name: string }>;
} {
  const users: Record<string, { id: string; name: string }> = {};
  const discussions: TDiscussion[] = [];

  for (const sd of serialized) {
    const discussionId = sd.id;

    const comments: TComment[] = sd.comments.map((sc) => {
      if (!users[sc.user]) {
        users[sc.user] = {
          id: sc.user,
          name: sc.user === "me" ? "Me" : sc.user,
        };
      }

      return {
        id: nanoid(),
        contentRich: [
          {
            type: "p",
            children: [{ text: sc.content }],
          },
        ],
        createdAt: new Date(sc.createdAt),
        discussionId,
        isEdited: false,
        userId: sc.user,
      };
    });

    discussions.push({
      id: discussionId,
      comments,
      createdAt: new Date(sd.createdAt),
      isResolved: false,
      userId: sd.comments[0]?.user ?? "me",
      documentContent: sd.documentContent,
    });
  }

  return { discussions, users };
}

/**
 * Find a text string within the Slate value, returning block/offset positions.
 * Handles both single-block and multi-block text spans.
 * usedRanges prevents the same range from being matched twice.
 */
function findTextInSlateValue(
  value: any[],
  searchText: string,
  usedRanges: Set<string>,
): {
  startBlock: number;
  startOffset: number;
  endBlock: number;
  endOffset: number;
} | null {
  // Extract plain text per block
  const blockTexts: string[] = value.map((block) =>
    block.children
      ? block.children
          .filter((c: any) => c.text !== undefined)
          .map((c: any) => c.text)
          .join("")
      : "",
  );

  // Check if searchText contains newlines (multi-block)
  const searchLines = searchText.split("\n");

  if (searchLines.length === 1) {
    // Single-block search
    for (let b = 0; b < blockTexts.length; b++) {
      let startFrom = 0;
      while (true) {
        const idx = blockTexts[b].indexOf(searchText, startFrom);
        if (idx === -1) break;
        const rangeKey = `${b}:${idx}:${b}:${idx + searchText.length}`;
        if (!usedRanges.has(rangeKey)) {
          usedRanges.add(rangeKey);
          return {
            startBlock: b,
            startOffset: idx,
            endBlock: b,
            endOffset: idx + searchText.length,
          };
        }
        startFrom = idx + 1;
      }
    }
  } else {
    // Multi-block search: first line must match suffix of a block,
    // last line must match prefix of a block, middle lines match exactly
    for (let b = 0; b <= blockTexts.length - searchLines.length; b++) {
      const firstLine = searchLines[0];
      const lastLine = searchLines[searchLines.length - 1];

      // Check if first line matches at end of block b
      if (!blockTexts[b].endsWith(firstLine)) continue;

      // Check middle lines match exactly
      let middleMatch = true;
      for (let m = 1; m < searchLines.length - 1; m++) {
        if (blockTexts[b + m] !== searchLines[m]) {
          middleMatch = false;
          break;
        }
      }
      if (!middleMatch) continue;

      // Check if last line matches at start of the last block
      const lastBlockIdx = b + searchLines.length - 1;
      if (!blockTexts[lastBlockIdx].startsWith(lastLine)) continue;

      const startOffset = blockTexts[b].length - firstLine.length;
      const endOffset = lastLine.length;
      const rangeKey = `${b}:${startOffset}:${lastBlockIdx}:${endOffset}`;

      if (!usedRanges.has(rangeKey)) {
        usedRanges.add(rangeKey);
        return {
          startBlock: b,
          startOffset,
          endBlock: lastBlockIdx,
          endOffset,
        };
      }
    }
  }

  return null;
}

/**
 * Apply comment marks by text-matching marker content against the Slate tree.
 */
function applyCommentMarksByTextMatch(
  value: any[],
  discussions: TDiscussion[],
  markers: Array<{ id: string; textContent: string }>,
) {
  const markerMap = new Map<string, string>();
  for (const m of markers) {
    markerMap.set(m.id, m.textContent);
  }

  const usedRanges = new Set<string>();

  for (const discussion of discussions) {
    const textContent =
      markerMap.get(discussion.id) ?? discussion.documentContent;
    if (!textContent) continue;

    const range = findTextInSlateValue(value, textContent, usedRanges);
    if (!range) continue;

    const commentKey = getCommentKey(discussion.id);

    if (range.startBlock === range.endBlock) {
      applyMarkToBlock(
        value,
        range.startBlock,
        range.startOffset,
        range.endOffset,
        commentKey,
      );
    } else {
      applyMarkToBlock(
        value,
        range.startBlock,
        range.startOffset,
        -1,
        commentKey,
      );
      for (let b = range.startBlock + 1; b < range.endBlock; b++) {
        applyMarkToBlock(value, b, 0, -1, commentKey);
      }
      applyMarkToBlock(value, range.endBlock, 0, range.endOffset, commentKey);
    }
  }
}

/**
 * Directly mutate a block's children to apply a comment mark
 * in the range [startOffset, endOffset). endOffset of -1 means end of block.
 */
function applyMarkToBlock(
  value: any[],
  blockIndex: number,
  startOffset: number,
  endOffset: number,
  commentKey: string,
) {
  const block = value[blockIndex];
  if (!block?.children) return;

  const totalLen = block.children.reduce(
    (sum: number, n: any) => sum + (n.text?.length ?? 0),
    0,
  );
  const actualEnd = endOffset === -1 ? totalLen : endOffset;
  if (startOffset >= actualEnd) return;

  // Build new children array with the mark applied at the right positions
  const newChildren: any[] = [];
  let pos = 0;

  for (const child of block.children) {
    if (child.text === undefined) {
      // Non-text node (inline element) — pass through
      newChildren.push(child);
      continue;
    }

    const text: string = child.text;
    const nodeStart = pos;
    const nodeEnd = pos + text.length;

    if (nodeEnd <= startOffset || nodeStart >= actualEnd) {
      // No overlap — keep as-is
      newChildren.push(child);
    } else {
      // Overlap — split into up to 3 parts: before, marked, after
      const overlapStart = Math.max(startOffset, nodeStart) - nodeStart;
      const overlapEnd = Math.min(actualEnd, nodeEnd) - nodeStart;

      if (overlapStart > 0) {
        newChildren.push({ ...child, text: text.slice(0, overlapStart) });
      }
      newChildren.push({
        ...child,
        text: text.slice(overlapStart, overlapEnd),
        [commentKey]: true,
        comment: true,
      });
      if (overlapEnd < text.length) {
        newChildren.push({ ...child, text: text.slice(overlapEnd) });
      }
    }

    pos = nodeEnd;
  }

  block.children = newChildren;
}

const editorPlugins = [
  ...BasicBlocksKit,
  ...BasicMarksKit,
  ...LinkKit,
  ...ListKit,
  ...CodeBlockKit,
  ...TableKit,
  ...EmojiKit,
  ...DateKit,
  ...ToggleKit,
  ...MarkdownKit,
  ...AutoformatKit,
  ...ExitBreakKit,
  ...SlashKit,
  ...FloatingToolbarKit,
  ...CommentKit,
  ...DiscussionKit,
];

interface EditorPaneParams {
  title: string;
  filePath?: string;
  isExternal?: boolean;
}

export function EditorPane(props: IDockviewPanelProps<EditorPaneParams>) {
  const filePath = props.params.filePath;
  const isExternal = props.params.isExternal ?? false;

  const [editor, setEditor] = useState<ReturnType<
    typeof createPlateEditor
  > | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const metadataRef = useRef<Record<string, unknown>>({});
  const hasOriginalFrontmatterRef = useRef(false);

  const [isFullWidth, setIsFullWidth] = useState(false);
  const [showButtons, setShowButtons] = useState(false);
  const [showDiffOverlay, setShowDiffOverlay] = useState(false);
  const [absoluteFilePath, setAbsoluteFilePath] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const btnTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scrollingRef = useRef(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // dirty tracking refs
  const savedUndoRef = useRef<unknown>(null);
  const commentDirtyRef = useRef(false);
  const initialLoadCompleteRef = useRef(false);

  const editorMaximized = useWorkspaceStore((s) => s.editorMaximized);
  const toggleEditorMaximized = useWorkspaceStore(
    (s) => s.toggleEditorMaximized,
  );
  const markDirty = useWorkspaceStore((s) => s.markDirty);
  const markClean = useWorkspaceStore((s) => s.markClean);

  // --- save callbacks ---

  const performSave = useCallback(async () => {
    if (!editor) return;

    const currentFilePath = props.params.filePath;
    const currentIsExternal = props.params.isExternal ?? false;

    // Cancel any pending metadata auto-save (full save includes metadata)
    if (metadataPersistTimerRef.current) {
      clearTimeout(metadataPersistTimerRef.current);
      metadataPersistTimerRef.current = undefined;
    }

    if (!currentFilePath) {
      // untitled - delegate to saveAs
      await performSaveAs();
      return;
    }

    // Serialize discussions with inline markers
    const discussions = editor.getOption(discussionPlugin, "discussions");
    const { serialized, markedValue } = serializeDiscussionsWithMarkers(
      editor,
      discussions,
    );
    const markdown = replaceMarkerPlaceholders(
      editor.getApi(MarkdownPlugin).markdown.serialize({ value: markedValue }),
    );

    if (serialized.length > 0) {
      metadataRef.current.discussions = serialized;
    } else {
      delete metadataRef.current.discussions;
    }

    if (currentIsExternal) {
      // external file: preserve original frontmatter behavior
      const rawContent = hasOriginalFrontmatterRef.current
        ? matter.stringify(markdown, metadataRef.current)
        : markdown;

      await invoke("update_external_file", {
        path: currentFilePath,
        content: rawContent,
      });
    } else {
      // internal file: always use frontmatter
      const rawContent = matter.stringify(markdown, metadataRef.current);
      await invoke("update_file", {
        path: currentFilePath,
        content: rawContent,
      });
    }

    // update dirty tracking
    savedUndoRef.current = lastElement(editor.history.undos) ?? null;
    commentDirtyRef.current = false;
    markClean(props.api.id);
  }, [
    editor,
    props.params.filePath,
    props.params.isExternal,
    props.api.id,
    markClean,
  ]);

  const performSaveAs = useCallback(async () => {
    if (!editor) return;

    // Cancel any pending metadata auto-save
    if (metadataPersistTimerRef.current) {
      clearTimeout(metadataPersistTimerRef.current);
      metadataPersistTimerRef.current = undefined;
    }

    // default to the tab title with .md extension, in the flowrite directory
    const tabTitle = props.params.title || "untitled";
    const defaultName = tabTitle.endsWith(".md") ? tabTitle : `${tabTitle}.md`;
    const baseDir = await getBaseDir();
    const defaultPath = `${baseDir}/${defaultName}`;

    const selectedPath = await saveDialog({
      defaultPath,
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
    });

    if (!selectedPath) return;

    // Serialize discussions with inline markers
    const discussions = editor.getOption(discussionPlugin, "discussions");
    const { serialized, markedValue } = serializeDiscussionsWithMarkers(
      editor,
      discussions,
    );
    const markdown = replaceMarkerPlaceholders(
      editor.getApi(MarkdownPlugin).markdown.serialize({ value: markedValue }),
    );
    const isExtPath = !(await isInternalPath(selectedPath));

    if (serialized.length > 0) {
      metadataRef.current.discussions = serialized;
    } else {
      delete metadataRef.current.discussions;
    }

    if (isExtPath) {
      const rawContent = hasOriginalFrontmatterRef.current
        ? matter.stringify(markdown, metadataRef.current)
        : markdown;

      await invoke("update_external_file", {
        path: selectedPath,
        content: rawContent,
      });

      // update panel params and title
      const fileName = selectedPath.split("/").pop() || selectedPath;
      const displayName = fileName.endsWith(".md")
        ? fileName.slice(0, -3)
        : fileName;

      props.api.updateParameters({
        filePath: selectedPath,
        isExternal: true,
      });
      props.api.setTitle(displayName);
    } else {
      // convert to relative path for internal file
      const baseDir = await getBaseDir();
      let relativePath = selectedPath;
      if (selectedPath.startsWith(baseDir)) {
        relativePath = selectedPath.slice(baseDir.length);
        if (relativePath.startsWith("/")) {
          relativePath = relativePath.slice(1);
        }
      }

      const rawContent = matter.stringify(markdown, metadataRef.current);
      await invoke("update_file", {
        path: relativePath,
        content: rawContent,
      });

      const fileName = relativePath.split("/").pop() || relativePath;
      const displayName = fileName.endsWith(".md")
        ? fileName.slice(0, -3)
        : fileName;

      props.api.updateParameters({
        filePath: relativePath,
        isExternal: false,
      });
      props.api.setTitle(displayName);
    }

    // update dirty tracking
    savedUndoRef.current = lastElement(editor.history.undos) ?? null;
    commentDirtyRef.current = false;
    markClean(props.api.id);
  }, [editor, props.api, props.params.title, markClean]);

  // --- register editor callbacks ---

  const [, forceRender] = useState(0);

  const focusEditor = useCallback(() => {
    if (!editor) return;
    editor.tf.focus();
    // Force a React re-render so Plate syncs the DOM selection
    // and the browser renders the caret.
    forceRender((n) => n + 1);
  }, [editor]);

  // --- metadata auto-persist with debounce ---

  const metadataPersistTimerRef =
    useRef<ReturnType<typeof setTimeout>>(undefined);

  const doMetadataPersist = useCallback(async () => {
    if (!editor || !filePath || isExternal || !initialLoadCompleteRef.current)
      return;

    // Serialize discussions into metadataRef (metadata-only, no body markers)
    const discussions = editor.getOption(discussionPlugin, "discussions");
    const { serialized } = serializeDiscussionsWithMarkers(editor, discussions);
    if (serialized.length > 0) {
      metadataRef.current.discussions = serialized;
    } else {
      delete metadataRef.current.discussions;
    }

    // Convert metadataRef to YAML string via gray-matter
    const raw = matter.stringify("", metadataRef.current);
    // matter.stringify produces "---\n{yaml}\n---\n\n", extract just the YAML
    const yamlMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    const yaml = yamlMatch ? yamlMatch[1] : "";

    if (!yaml.trim()) return;

    try {
      await invoke("write_file_metadata", { path: filePath, yaml });
    } catch (err) {
      console.error("failed to auto-save metadata:", err);
    }
  }, [editor, filePath, isExternal]);

  const triggerPersistMetadata = useCallback(() => {
    if (metadataPersistTimerRef.current)
      clearTimeout(metadataPersistTimerRef.current);
    metadataPersistTimerRef.current = setTimeout(doMetadataPersist, 500);
  }, [doMetadataPersist]);

  const toggleFullWidth = useCallback(() => {
    setIsFullWidth((prev) => {
      const next = !prev;
      metadataRef.current.fullWidth = next;
      triggerPersistMetadata();
      return next;
    });
  }, [triggerPersistMetadata]);

  const toggleMaximize = useCallback(() => {
    if (editorMaximized) {
      invoke("set_traffic_lights_visible", { visible: true });
    } else {
      props.api.maximize();
      invoke("set_traffic_lights_visible", { visible: false });
    }
    toggleEditorMaximized();
  }, [editorMaximized, props.api, toggleEditorMaximized]);

  const markContentDirty = useCallback(() => {
    commentDirtyRef.current = true;
    markDirty(props.api.id);
  }, [props.api.id, markDirty]);

  useEffect(() => {
    registerEditor(props.api.id, {
      save: performSave,
      saveAs: performSaveAs,
      focus: focusEditor,
      toggleMaximize,
      toggleFullWidth,
      persistMetadata: triggerPersistMetadata,
      markContentDirty,
    });
    return () => unregisterEditor(props.api.id);
  }, [
    props.api.id,
    performSave,
    performSaveAs,
    focusEditor,
    toggleMaximize,
    toggleFullWidth,
    triggerPersistMetadata,
    markContentDirty,
  ]);

  // load file content and create editor
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      if (filePath) {
        setIsLoading(true);
        initialLoadCompleteRef.current = false;
        try {
          let rawContent: string;

          if (isExternal) {
            rawContent = await invoke<string>("read_external_file", {
              path: filePath,
            });
          } else {
            rawContent = await invoke<string>("read_file", {
              path: filePath,
            });
          }

          if (cancelled) return;

          const parsed = matter(rawContent);
          metadataRef.current = parsed.data;
          hasOriginalFrontmatterRef.current =
            Object.keys(parsed.data).length > 0;

          // Restore fullWidth preference from frontmatter
          if (parsed.data.fullWidth === true) {
            setIsFullWidth(true);
          }

          // Deserialize discussions from frontmatter
          let discussionState:
            | {
                discussions: TDiscussion[];
                users: Record<string, { id: string; name: string }>;
              }
            | undefined;
          let markers: Array<{ id: string; textContent: string }> | undefined;
          let contentToDeserialize = parsed.content;

          if (
            parsed.data.discussions &&
            Array.isArray(parsed.data.discussions)
          ) {
            const extracted = extractAndStripMarkers(parsed.content);
            contentToDeserialize = extracted.cleanMarkdown;
            markers = extracted.markers;
            discussionState = deserializeDiscussions(parsed.data.discussions);
          }

          const ed = createPlateEditor({
            plugins: editorPlugins,
            value: (editor) => {
              const nodes = editor
                .getApi(MarkdownPlugin)
                .markdown.deserialize(contentToDeserialize);

              // Apply comment marks directly into the value before editor mounts
              if (discussionState && markers) {
                applyCommentMarksByTextMatch(
                  nodes,
                  discussionState.discussions,
                  markers,
                );
              }

              return nodes;
            },
          });

          // Set discussion data on the editor
          if (discussionState) {
            ed.setOption(
              discussionPlugin,
              "discussions",
              discussionState.discussions,
            );
            ed.setOption(discussionPlugin, "users", {
              ...ed.getOption(discussionPlugin, "users"),
              ...discussionState.users,
            });
          }

          setEditor(ed);

          // mark initial load complete after editor settles
          requestAnimationFrame(() => {
            if (!cancelled) {
              savedUndoRef.current = lastElement(ed.history.undos) ?? null;
              initialLoadCompleteRef.current = true;
            }
          });
        } catch (err) {
          if (cancelled) return;
          console.error("failed to load file:", err);
          const ed = createPlateEditor({ plugins: editorPlugins });
          setEditor(ed);
          requestAnimationFrame(() => {
            if (!cancelled) {
              initialLoadCompleteRef.current = true;
            }
          });
        } finally {
          if (!cancelled) setIsLoading(false);
        }
      } else {
        // untitled tab — create empty editor
        const ed = createPlateEditor({ plugins: editorPlugins });
        setEditor(ed);
        setIsLoading(false);
        requestAnimationFrame(() => {
          if (!cancelled) {
            savedUndoRef.current = lastElement(ed.history.undos) ?? null;
            initialLoadCompleteRef.current = true;
          }
        });
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [filePath, isExternal]);

  // --- resolve absolute file path for diff store lookups ---
  useEffect(() => {
    if (!filePath) {
      setAbsoluteFilePath(null);
      return;
    }
    if (isExternal) {
      setAbsoluteFilePath(filePath);
    } else {
      getBaseDir().then((baseDir) => {
        setAbsoluteFilePath(`${baseDir}/${filePath}`);
      });
    }
  }, [filePath, isExternal]);

  // --- subscribe to diff store for pending diffs on this file ---
  useEffect(() => {
    if (!absoluteFilePath || !filePath?.endsWith(".md")) return;

    const unsubscribe = useDiffStore.subscribe(() => {
      const diff = useDiffStore
        .getState()
        .getActiveDiffForFile(absoluteFilePath);
      if (diff && !showDiffOverlay) {
        setShowDiffOverlay(true);
      }
    });

    // Check on mount too
    const diff = useDiffStore.getState().getActiveDiffForFile(absoluteFilePath);
    if (diff) {
      setShowDiffOverlay(true);
    }

    return unsubscribe;
  }, [absoluteFilePath, filePath]);

  // --- cleanup metadata persist timer on unmount ---
  useEffect(() => {
    return () => {
      if (metadataPersistTimerRef.current) {
        clearTimeout(metadataPersistTimerRef.current);
      }
    };
  }, []);

  // --- sync active editor to workspace store ---
  useEffect(() => {
    if (!editor) return;

    const setActiveEditor = useWorkspaceStore.getState().setActiveEditor;

    // Check if this panel is currently active
    const checkAndSync = () => {
      if (props.api.isActive) {
        setActiveEditor(editor);
      }
    };

    checkAndSync();

    const disposable = props.api.onDidActiveChange((event) => {
      if (event.isActive) {
        setActiveEditor(editor);
      }
    });

    return () => {
      disposable.dispose();
      // Clear active editor if this was the active one
      const current = useWorkspaceStore.getState().activeEditor;
      if (current === editor) {
        setActiveEditor(null);
      }
    };
  }, [editor, props.api]);

  // --- onChange handler for dirty tracking ---
  const handleEditorChange = useCallback(() => {
    if (!initialLoadCompleteRef.current || !editor) return;

    const currentTop = lastElement(editor.history.undos) ?? null;
    if (currentTop !== savedUndoRef.current || commentDirtyRef.current) {
      markDirty(props.api.id);
    } else {
      markClean(props.api.id);
    }
  }, [editor, props.api.id, markDirty, markClean]);

  // mouse movement: show buttons (unless mid-scroll)
  const handleMouseMove = useCallback(() => {
    if (scrollingRef.current) return;
    setShowButtons(true);
    if (btnTimerRef.current) clearTimeout(btnTimerRef.current);
    btnTimerRef.current = setTimeout(
      () => setShowButtons(false),
      BUTTON_TIMEOUT,
    );
  }, []);

  // mouse leaves: hide buttons
  const handleMouseLeave = useCallback(() => {
    setShowButtons(false);
    if (btnTimerRef.current) clearTimeout(btnTimerRef.current);
  }, []);

  // capture-phase scroll listener: hide buttons during scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => {
      setShowButtons((prev) => (prev ? false : prev));
      if (btnTimerRef.current) clearTimeout(btnTimerRef.current);

      scrollingRef.current = true;
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        scrollingRef.current = false;
      }, SCROLL_DEBOUNCE);
    };

    el.addEventListener("scroll", onScroll, true);

    return () => {
      el.removeEventListener("scroll", onScroll, true);
      if (btnTimerRef.current) clearTimeout(btnTimerRef.current);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, []);

  const handleToggleMaximize = toggleMaximize;

  // prevent interactive elements inside the editor (checkboxes, etc.) from
  // being reachable via Tab — they should only be clickable with mouse
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !editor) return;

    let rafId = 0;

    const disableTabOnFocusables = () => {
      container
        .querySelectorAll<HTMLElement>(
          'input:not([tabindex="-1"]), [role="checkbox"]:not([tabindex="-1"])',
        )
        .forEach((el) => (el.tabIndex = -1));
    };

    disableTabOnFocusables();
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(disableTabOnFocusables);
    });
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [editor]);

  // loading state
  if (isLoading || !editor) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/50" />
      </div>
    );
  }

  // diff overlay
  const activeDiff =
    absoluteFilePath && showDiffOverlay
      ? useDiffStore.getState().getActiveDiffForFile(absoluteFilePath)
      : null;

  if (activeDiff && showDiffOverlay) {
    return (
      <DiffOverlay
        oldText={activeDiff.oldText}
        newText={activeDiff.newText}
        filePath={activeDiff.path}
        sessionId={activeDiff.sessionId}
        onDismiss={() => {
          setShowDiffOverlay(false);
          // Reload the file content after diff resolution
          if (filePath) {
            setIsLoading(true);
            setEditor(null);
          }
        }}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <Plate editor={editor} onChange={handleEditorChange}>
        <ScrollArea
          className="h-full w-full editor-pane-scroll-area"
          maskHeight={0}
        >
          <EditorContainer className="w-full h-auto min-h-full overflow-y-visible">
            <PlateEditor
              variant="fullWidth"
              autoFocus={false}
              tabIndex={-1}
              className={cn(
                "h-auto min-h-full pt-15 px-10",
                isFullWidth && "sm:px-10 sm:pt-6",
              )}
              placeholder="start typing..."
            />
          </EditorContainer>
        </ScrollArea>
      </Plate>

      {/* toolbar icons */}
      <div
        className={cn(
          "absolute top-2 right-2 z-10 flex items-center gap-0.5",
          "transition-opacity duration-300",
          showButtons ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      >
        {/* width toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              tabIndex={-1}
              onClick={() => {
                toggleFullWidth();
                requestAnimationFrame(() => editor.tf.focus());
              }}
              className="flex h-7 w-7 items-center justify-center rounded-md text-foreground/30 transition-colors hover:bg-foreground/8 hover:text-foreground/70"
            >
              {isFullWidth ? (
                <FoldHorizontal className="h-4 w-4" />
              ) : (
                <UnfoldHorizontal className="h-4 w-4" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {isFullWidth ? "center content" : "full width"}
          </TooltipContent>
        </Tooltip>

        {/* maximize / minimize toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              tabIndex={-1}
              onClick={() => {
                handleToggleMaximize();
                requestAnimationFrame(() => editor.tf.focus());
              }}
              className="flex h-7 w-7 items-center justify-center rounded-md text-foreground/30 transition-colors hover:bg-foreground/8 hover:text-foreground/70"
            >
              {editorMaximized ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {editorMaximized ? "minimize" : "maximize"}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
