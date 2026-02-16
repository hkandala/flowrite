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
import { listen } from "@tauri-apps/api/event";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import matter from "gray-matter";
import { MarkdownPlugin } from "@platejs/markdown";
import { getCommentKey } from "@platejs/comment";
import { CommentPlugin } from "@platejs/comment/react";
import { nanoid, NodeApi } from "platejs";

import { cn, getBaseDir, isInternalPath } from "@/lib/utils";
import { FILE_WATCHER_EVENT } from "@/lib/constants";
import { Editor as PlateEditor, EditorContainer } from "@/components/ui/editor";
import { Kbd } from "@/components/ui/kbd";
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
  generateDiscussionId,
  type TDiscussion,
} from "../editor/plugins/discussion-kit";
import type { TComment } from "@/components/ui/comment";

const BUTTON_TIMEOUT = 1500;
const SCROLL_DEBOUNCE = 300;

/** Get the last element of an array (ES2020-safe alternative to .at(-1)) */
function lastElement<T>(arr: T[]): T | undefined {
  return arr[arr.length - 1];
}

// --- comment serialization/deserialization ---

import { matchQuote } from "@/lib/match-quote";

interface SerializedComment {
  user: string;
  content: string;
  createdAt: string;
}

interface SerializedSelector {
  exact: string;
  prefix?: string;
  suffix?: string;
}

interface SerializedDiscussion {
  selector?: SerializedSelector;
  createdAt: string;
  comments: SerializedComment[];
}

/** Extract plain text from a Slate Value (rich text). */
function richTextToPlain(value: unknown[]): string {
  return value.map((node) => NodeApi.string(node as any)).join("\n");
}

/**
 * Build plain text from a Slate node tree, inserting "\n" between
 * block-level children (elements with children arrays).
 * Tracks character offsets for each text leaf via the callback.
 */
function buildPlainText(
  nodes: any[],
  onLeaf?: (textNode: any, offset: number) => void,
): string {
  const parts: string[] = [];
  let offset = 0;

  function walk(node: any) {
    if (typeof node.text === "string") {
      onLeaf?.(node, offset);
      parts.push(node.text);
      offset += node.text.length;
      return;
    }
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        // Insert \n before block-level children (except the first)
        const isBlock = child.children != null;
        if (isBlock && i > 0) {
          parts.push("\n");
          offset += 1;
        }
        walk(child);
      }
    }
  }

  for (let i = 0; i < nodes.length; i++) {
    if (i > 0) {
      parts.push("\n");
      offset += 1;
    }
    walk(nodes[i]);
  }

  return parts.join("");
}

/**
 * Serialize discussions to frontmatter format using TextQuoteSelector.
 * Prefix/suffix are extracted from Slate plain text for clean,
 * readable YAML without markdown syntax characters.
 */
function serializeDiscussions(
  editor: ReturnType<typeof createPlateEditor>,
  discussions: TDiscussion[],
): SerializedDiscussion[] {
  const activeDiscussions = discussions.filter((d) => !d.isResolved);
  if (activeDiscussions.length === 0) return [];

  // Build posMap: discussionId → document content + precise char offset
  const posMap = new Map<
    string,
    {
      docContent: string;
      lastSeenBlock: number;
      charOffset: number;
    }
  >();

  const blocks = editor.children;

  // Build full plain text with precise leaf offsets using recursive walker
  const leafOffsets = new Map<any, number>();
  const fullText = buildPlainText(blocks, (textNode, offset) => {
    leafOffsets.set(textNode, offset);
  });

  for (let blockIdx = 0; blockIdx < blocks.length; blockIdx++) {
    const block = blocks[blockIdx];
    const textNodes = Array.from(NodeApi.texts(block as any));

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
            docContent: text,
            lastSeenBlock: blockIdx,
            charOffset: leafOffsets.get(textNode) ?? 0,
          });
        } else {
          if (existing.lastSeenBlock === blockIdx) {
            existing.docContent += text;
          } else {
            existing.docContent += "\n" + text;
            existing.lastSeenBlock = blockIdx;
          }
        }
      }
    }
  }

  // Build serialized discussions with selectors
  const serialized: SerializedDiscussion[] = [];

  for (const discussion of activeDiscussions) {
    const pos = posMap.get(discussion.id);
    const exact = pos?.docContent ?? discussion.documentContent ?? "";

    let selector: SerializedSelector | undefined;

    if (exact) {
      // Find the nearest exact occurrence in fullText closest to the hint.
      // We use indexOf (not matchQuote) because we know the text is exact —
      // it comes from the same Slate tree — and need position to be the
      // sole tiebreaker for short/duplicate strings like "and" or ".".
      const hint = pos?.charOffset ?? 0;
      let bestStart = -1;
      let bestDist = Infinity;
      let searchFrom = 0;
      while (true) {
        const idx = fullText.indexOf(exact, searchFrom);
        if (idx === -1) break;
        const dist = Math.abs(idx - hint);
        if (dist < bestDist) {
          bestDist = dist;
          bestStart = idx;
        }
        searchFrom = idx + 1;
      }

      if (bestStart !== -1) {
        const matchStart = bestStart;
        const matchEnd = bestStart + exact.length;
        // Check if exact is unique — skip prefix/suffix if so
        const firstIdx = fullText.indexOf(exact);
        const isUnique =
          firstIdx !== -1 && fullText.indexOf(exact, firstIdx + 1) === -1;

        selector = { exact };

        if (!isUnique) {
          const prefix = fullText.slice(
            Math.max(0, matchStart - 32),
            matchStart,
          );
          const suffix = fullText.slice(matchEnd, matchEnd + 32);

          if (prefix) selector.prefix = prefix;
          if (suffix) selector.suffix = suffix;
        }
      } else {
        // Fallback: store exact only (no prefix/suffix) if not found in plain text
        selector = { exact };
      }
    }

    const entry: SerializedDiscussion = {
      createdAt: new Date(discussion.createdAt).toISOString(),
      comments: discussion.comments.map((c) => ({
        user: c.userId,
        content: richTextToPlain(c.contentRich),
        createdAt: new Date(c.createdAt).toISOString(),
      })),
    };
    if (selector) entry.selector = selector;
    serialized.push(entry);
  }

  return serialized;
}

// --- ephemeral marker helpers ---

const MARKER_DELIM = "\uE000";

function makeStartMarker(id: string): string {
  return `${MARKER_DELIM}S${id}${MARKER_DELIM}`;
}

function makeEndMarker(id: string): string {
  return `${MARKER_DELIM}E${id}${MARKER_DELIM}`;
}

const MARKER_RE = /\uE000([SE])([A-Za-z]{4})\uE000/g;

/**
 * Deserialize frontmatter discussions.
 * Generates runtime IDs, matches selectors against raw markdown,
 * and injects ephemeral markers so the markdown parser carries position
 * information into the Slate tree.
 */
function deserializeDiscussions(
  markdown: string,
  serialized: SerializedDiscussion[],
): {
  markedMarkdown: string;
  discussions: TDiscussion[];
  users: Record<string, { id: string; name: string }>;
} {
  const users: Record<string, { id: string; name: string }> = {};
  const discussions: TDiscussion[] = [];
  const injections: { pos: number; marker: string; isEnd: boolean }[] = [];

  for (const sd of serialized) {
    const discussionId = generateDiscussionId();

    // Match selector against raw markdown and collect injection points
    if (sd.selector) {
      const match = matchQuote(markdown, sd.selector.exact, {
        prefix: sd.selector.prefix,
        suffix: sd.selector.suffix,
      });
      if (match) {
        injections.push({
          pos: match.start,
          marker: makeStartMarker(discussionId),
          isEnd: false,
        });
        injections.push({
          pos: match.end,
          marker: makeEndMarker(discussionId),
          isEnd: true,
        });
      }
    }

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
      documentContent: sd.selector?.exact,
    });
  }

  // Sort injections descending by position so earlier injections
  // don't shift later positions. At same position: end markers first.
  injections.sort((a, b) => {
    if (a.pos !== b.pos) return b.pos - a.pos;
    // end markers before start markers at same position
    return a.isEnd === b.isEnd ? 0 : a.isEnd ? -1 : 1;
  });

  let markedMarkdown = markdown;
  for (const inj of injections) {
    markedMarkdown =
      markedMarkdown.slice(0, inj.pos) +
      inj.marker +
      markedMarkdown.slice(inj.pos);
  }

  return { markedMarkdown, discussions, users };
}

/**
 * Walk the Slate tree, find ephemeral markers in text nodes,
 * strip them, and apply comment marks at the exact positions.
 * `activeIds` persists across blocks so multi-block comments work.
 */
function stripMarkersAndApplyComments(nodes: any[]): void {
  const activeIds = new Set<string>();

  function processNode(node: any): void {
    if (!node.children) return;

    const newChildren: any[] = [];
    for (const child of node.children) {
      if (child.text !== undefined) {
        processTextNode(child, activeIds, newChildren);
      } else {
        processNode(child);
        newChildren.push(child);
      }
    }
    node.children = newChildren;
  }

  for (const node of nodes) {
    processNode(node);
  }
}

function processTextNode(
  textNode: any,
  activeIds: Set<string>,
  output: any[],
): void {
  const text: string = textNode.text;

  // Fast path: no markers in this node
  if (!text.includes(MARKER_DELIM)) {
    if (text.length > 0) {
      emitText(textNode, text, activeIds, output);
    }
    return;
  }

  // Scan for markers
  let lastIndex = 0;
  MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = MARKER_RE.exec(text)) !== null) {
    // Emit text segment before this marker
    const segment = text.slice(lastIndex, m.index);
    if (segment.length > 0) {
      emitText(textNode, segment, activeIds, output);
    }

    // Process marker: update activeIds
    const type = m[1]; // "S" or "E"
    const id = m[2]; // 4-char discussion ID
    if (type === "S") {
      activeIds.add(id);
    } else {
      activeIds.delete(id);
    }

    lastIndex = m.index + m[0].length;
  }

  // Emit remaining text after last marker
  const remaining = text.slice(lastIndex);
  if (remaining.length > 0) {
    emitText(textNode, remaining, activeIds, output);
  }
}

function emitText(
  originalNode: any,
  text: string,
  activeIds: Set<string>,
  output: any[],
): void {
  const node: any = { ...originalNode, text };

  if (activeIds.size > 0) {
    node.comment = true;
    for (const id of activeIds) {
      node[getCommentKey(id)] = true;
    }
  }

  output.push(node);
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

  const containerRef = useRef<HTMLDivElement>(null);
  const btnTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scrollingRef = useRef(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // dirty tracking refs
  const savedUndoRef = useRef<unknown>(null);
  const initialLoadCompleteRef = useRef(false);

  // file watcher self-save guard
  const lastSaveTimestampRef = useRef(0);

  // orphan discussion cleanup timer
  const orphanCleanupTimerRef =
    useRef<ReturnType<typeof setTimeout>>(undefined);
  // track which discussions were auto-resolved (vs manually resolved by user)
  const autoResolvedIdsRef = useRef(new Set<string>());

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

    // Serialize discussions (uses Slate plain text for selectors)
    const discussions = editor.getOption(discussionPlugin, "discussions");
    const serialized = serializeDiscussions(editor, discussions);
    const markdown = editor.getApi(MarkdownPlugin).markdown.serialize();

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

    lastSaveTimestampRef.current = Date.now();

    // update dirty tracking
    savedUndoRef.current = lastElement(editor.history.undos) ?? null;
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

    // Serialize discussions (uses Slate plain text for selectors)
    const discussions = editor.getOption(discussionPlugin, "discussions");
    const serialized = serializeDiscussions(editor, discussions);
    const markdown = editor.getApi(MarkdownPlugin).markdown.serialize();
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
    if (!editor || !filePath || !initialLoadCompleteRef.current) return;

    // Serialize discussions into metadataRef
    const discussions = editor.getOption(discussionPlugin, "discussions");
    const serialized = serializeDiscussions(editor, discussions);
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

    if (!yaml.trim()) {
      // No metadata left — remove frontmatter from file if it previously had some
      if (!hasOriginalFrontmatterRef.current) return;

      try {
        if (isExternal) {
          const rawContent = await invoke<string>("read_external_file", {
            path: filePath,
          });
          const parsed = matter(rawContent);
          // Write back just the content without frontmatter
          await invoke("update_external_file", {
            path: filePath,
            content: parsed.content,
          });
        } else {
          // Remove frontmatter by writing full file via update_file
          const markdown = editor.getApi(MarkdownPlugin).markdown.serialize();
          await invoke("update_file", {
            path: filePath,
            content: markdown,
          });
          hasOriginalFrontmatterRef.current = false;
        }
        lastSaveTimestampRef.current = Date.now();
      } catch (err) {
        console.error("failed to clear metadata:", err);
      }
      return;
    }

    try {
      if (isExternal) {
        // External files: read current content, replace/add frontmatter, write back
        const rawContent = await invoke<string>("read_external_file", {
          path: filePath,
        });
        const parsed = matter(rawContent);
        const updatedContent = matter.stringify(parsed.content, {
          ...parsed.data,
          ...metadataRef.current,
        });
        await invoke("update_external_file", {
          path: filePath,
          content: updatedContent,
        });
      } else {
        await invoke("write_file_metadata", { path: filePath, yaml });
      }
      lastSaveTimestampRef.current = Date.now();
    } catch (err) {
      console.error("failed to auto-save metadata:", err);
    }
  }, [editor, filePath, isExternal]);

  const triggerPersistMetadata = useCallback(() => {
    if (metadataPersistTimerRef.current)
      clearTimeout(metadataPersistTimerRef.current);
    metadataPersistTimerRef.current = setTimeout(doMetadataPersist, 500);
  }, [doMetadataPersist]);

  const cleanupOrphanedDiscussions = useCallback(() => {
    if (!editor || !initialLoadCompleteRef.current) return;

    const discussions = editor.getOption(discussionPlugin, "discussions");
    const commentApi = editor.getApi(CommentPlugin).comment;

    const orphanIds: string[] = [];
    const restoredIds: string[] = [];

    for (const d of discussions) {
      if (!d.documentContent) continue;

      if (!d.isResolved) {
        // Unresolved discussion whose marks are gone → auto-resolve
        if (!commentApi.has({ id: d.id })) {
          orphanIds.push(d.id);
        }
      } else if (autoResolvedIdsRef.current.has(d.id)) {
        // Auto-resolved discussion whose marks came back (undo/cut-paste) → un-resolve
        if (commentApi.has({ id: d.id })) {
          restoredIds.push(d.id);
        }
      }
    }

    if (orphanIds.length === 0 && restoredIds.length === 0) return;

    for (const id of orphanIds) {
      autoResolvedIdsRef.current.add(id);
    }
    for (const id of restoredIds) {
      autoResolvedIdsRef.current.delete(id);
    }

    const orphanSet = new Set(orphanIds);
    const restoredSet = new Set(restoredIds);
    const updated = discussions.map((d: TDiscussion) => {
      if (orphanSet.has(d.id)) return { ...d, isResolved: true };
      if (restoredSet.has(d.id)) return { ...d, isResolved: false };
      return d;
    });
    editor.setOption(discussionPlugin, "discussions", updated);
    triggerPersistMetadata();
  }, [editor, triggerPersistMetadata]);

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

  useEffect(() => {
    registerEditor(props.api.id, {
      save: performSave,
      saveAs: performSaveAs,
      focus: focusEditor,
      toggleMaximize,
      toggleFullWidth,
      persistMetadata: triggerPersistMetadata,
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
  ]);

  // load file content and create editor
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      // --- Normal mode: load file from disk ---
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
                markedMarkdown: string;
                discussions: TDiscussion[];
                users: Record<string, { id: string; name: string }>;
              }
            | undefined;

          if (
            parsed.data.discussions &&
            Array.isArray(parsed.data.discussions)
          ) {
            discussionState = deserializeDiscussions(
              parsed.content,
              parsed.data.discussions,
            );
          }

          const ed = createPlateEditor({
            plugins: editorPlugins,
            value: (editor) => {
              const contentToDeserialize = discussionState
                ? discussionState.markedMarkdown
                : parsed.content;
              const nodes = editor
                .getApi(MarkdownPlugin)
                .markdown.deserialize(contentToDeserialize);

              // Strip ephemeral markers and apply comment marks
              if (discussionState) {
                stripMarkersAndApplyComments(nodes);
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

  // --- cleanup metadata persist timer on unmount ---
  useEffect(() => {
    return () => {
      if (metadataPersistTimerRef.current) {
        clearTimeout(metadataPersistTimerRef.current);
      }
      if (orphanCleanupTimerRef.current) {
        clearTimeout(orphanCleanupTimerRef.current);
      }
    };
  }, []);

  // --- file watcher: reload editor when file changes on disk ---
  useEffect(() => {
    if (!editor || !filePath || isExternal || !filePath.endsWith(".md")) return;

    let unlisten: (() => void) | null = null;

    const setup = async () => {
      unlisten = await listen<{
        fileChanges: { path: string; kind: string }[];
        directoryChanges: string[];
      }>(FILE_WATCHER_EVENT, async (event) => {
        // Check if current file appears in any file change event.
        // We match any kind (not just "modify") because atomic saves
        // on macOS can produce "delete" events when the rename source
        // is a hidden temp file that gets filtered by the watcher.
        // We verify the file still exists by attempting to read it.
        const match = event.payload.fileChanges.find(
          (change) => change.path === filePath,
        );
        if (!match) return;

        // Guard against self-edits: skip events within 1s of a save
        if (Date.now() - lastSaveTimestampRef.current < 1000) return;

        // Guard: editor must be loaded
        if (!initialLoadCompleteRef.current) return;

        try {
          const rawContent = await invoke<string>("read_file", {
            path: filePath,
          });
          const parsed = matter(rawContent);

          // Deserialize new content to Plate nodes
          const currentDiscussions = JSON.stringify(
            metadataRef.current.discussions ?? null,
          );
          const newDiscussions = JSON.stringify(
            parsed.data.discussions ?? null,
          );
          const discussionsChanged = currentDiscussions !== newDiscussions;

          let newNodes: any[];

          if (
            discussionsChanged &&
            parsed.data.discussions &&
            Array.isArray(parsed.data.discussions)
          ) {
            // Re-deserialize discussions with ephemeral markers
            const discussionState = deserializeDiscussions(
              parsed.content,
              parsed.data.discussions,
            );
            newNodes = editor
              .getApi(MarkdownPlugin)
              .markdown.deserialize(discussionState.markedMarkdown);
            stripMarkersAndApplyComments(newNodes);

            // Update discussion plugin options
            editor.setOption(
              discussionPlugin,
              "discussions",
              discussionState.discussions,
            );
            editor.setOption(discussionPlugin, "users", {
              ...editor.getOption(discussionPlugin, "users"),
              ...discussionState.users,
            });
          } else {
            newNodes = editor
              .getApi(MarkdownPlugin)
              .markdown.deserialize(parsed.content);
          }

          // Compare before replacing to avoid spurious undo entries
          const currentMarkdown = editor
            .getApi(MarkdownPlugin)
            .markdown.serialize();
          const newMarkdown = parsed.content;
          if (currentMarkdown === newMarkdown && !discussionsChanged) {
            return;
          }

          // Replace editor content in-place (preserves undo history)
          editor.tf.replaceNodes(newNodes, { at: [], children: true });

          // Update metadata and dirty tracking baseline
          metadataRef.current = parsed.data;
          hasOriginalFrontmatterRef.current =
            Object.keys(parsed.data).length > 0;
          savedUndoRef.current = lastElement(editor.history.undos) ?? null;
          markClean(props.api.id);
        } catch (err) {
          console.error("file watcher reload failed:", err);
        }
      });
    };

    setup();

    return () => {
      if (unlisten) unlisten();
    };
  }, [filePath, isExternal, editor]);

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
    if (currentTop !== savedUndoRef.current) {
      markDirty(props.api.id);
    } else {
      markClean(props.api.id);
    }

    // Schedule orphan cleanup (debounced)
    if (orphanCleanupTimerRef.current)
      clearTimeout(orphanCleanupTimerRef.current);
    orphanCleanupTimerRef.current = setTimeout(cleanupOrphanedDiscussions, 500);
  }, [editor, props.api.id, markDirty, markClean, cleanupOrphanedDiscussions]);

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
            {isFullWidth ? "center content" : "full width"} <Kbd>⌘⇧-</Kbd>
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
            {editorMaximized ? "minimize" : "maximize"} <Kbd>⌘⇧=</Kbd>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
