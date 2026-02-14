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
  generateDiscussionId,
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

import { matchQuote, type TextQuoteSelector } from "@/lib/match-quote";

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

/** Extract plain text from each block in the Slate tree. */
function getBlockTexts(blocks: any[]): string[] {
  return blocks.map((block) =>
    block.children
      ? block.children
          .filter((c: any) => c.text !== undefined)
          .map((c: any) => c.text)
          .join("")
      : "",
  );
}

/**
 * Extract ~charCount characters of text preceding a position.
 * Walks backward through blocks to collect enough context.
 */
function extractPrefix(
  blockTexts: string[],
  blockIdx: number,
  offset: number,
  charCount: number,
): string {
  let result = blockTexts[blockIdx].slice(0, offset);

  let b = blockIdx - 1;
  while (result.length < charCount && b >= 0) {
    result = blockTexts[b] + "\n" + result;
    b--;
  }

  if (result.length > charCount) {
    result = result.slice(result.length - charCount);
  }

  return result;
}

/**
 * Extract ~charCount characters of text following a position.
 * Walks forward through blocks to collect enough context.
 */
function extractSuffix(
  blockTexts: string[],
  blockIdx: number,
  offset: number,
  charCount: number,
): string {
  let result = blockTexts[blockIdx].slice(offset);

  let b = blockIdx + 1;
  while (result.length < charCount && b < blockTexts.length) {
    result = result + "\n" + blockTexts[b];
    b++;
  }

  if (result.length > charCount) {
    result = result.slice(0, charCount);
  }

  return result;
}

/**
 * Serialize discussions to frontmatter format using TextQuoteSelector.
 * No marker injection into the Slate tree — only builds frontmatter data.
 */
function serializeDiscussions(
  editor: ReturnType<typeof createPlateEditor>,
  discussions: TDiscussion[],
): SerializedDiscussion[] {
  const activeDiscussions = discussions.filter((d) => !d.isResolved);
  if (activeDiscussions.length === 0) return [];

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

  // Extract plain text per block for prefix/suffix computation
  const blockTexts = getBlockTexts(blocks as any[]);

  // Build serialized discussions with selectors
  const serialized: SerializedDiscussion[] = [];

  for (const discussion of activeDiscussions) {
    const pos = posMap.get(discussion.id);
    const exact = pos?.docContent ?? discussion.documentContent ?? "";

    let selector: SerializedSelector | undefined;

    if (exact && pos) {
      const prefix = extractPrefix(
        blockTexts,
        pos.startBlock,
        pos.startOffset,
        32,
      );
      const suffix = extractSuffix(blockTexts, pos.endBlock, pos.endOffset, 32);

      selector = { exact };
      if (prefix) selector.prefix = prefix;
      if (suffix) selector.suffix = suffix;
    }

    serialized.push({
      selector,
      createdAt: new Date(discussion.createdAt).toISOString(),
      comments: discussion.comments.map((c) => ({
        user: c.userId,
        content: richTextToPlain(c.contentRich),
        createdAt: new Date(c.createdAt).toISOString(),
      })),
    });
  }

  return serialized;
}

/**
 * Deserialize frontmatter discussions.
 * Generates runtime IDs (not persisted) and builds a selector map for anchoring.
 */
function deserializeDiscussions(serialized: SerializedDiscussion[]): {
  discussions: TDiscussion[];
  users: Record<string, { id: string; name: string }>;
  selectorMap: Map<string, TextQuoteSelector>;
} {
  const users: Record<string, { id: string; name: string }> = {};
  const discussions: TDiscussion[] = [];
  const selectorMap = new Map<string, TextQuoteSelector>();

  for (const sd of serialized) {
    const discussionId = generateDiscussionId();

    if (sd.selector) {
      selectorMap.set(discussionId, sd.selector);
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

  return { discussions, users, selectorMap };
}

/**
 * Convert a global character offset in flattened document text
 * to a { blockIndex, offset } position within the Slate block array.
 */
function globalOffsetToBlockPosition(
  blockTexts: string[],
  globalOffset: number,
): { blockIndex: number; offset: number } {
  let consumed = 0;
  for (let i = 0; i < blockTexts.length; i++) {
    const blockLen = blockTexts[i].length;
    if (globalOffset <= consumed + blockLen) {
      return { blockIndex: i, offset: globalOffset - consumed };
    }
    consumed += blockLen + 1; // +1 for the \n separator
  }
  const lastIdx = blockTexts.length - 1;
  return { blockIndex: lastIdx, offset: blockTexts[lastIdx].length };
}

/**
 * Find a text range in the Slate value using TextQuoteSelector and matchQuote.
 */
function findTextWithSelector(
  value: any[],
  selector: TextQuoteSelector,
): {
  startBlock: number;
  startOffset: number;
  endBlock: number;
  endOffset: number;
} | null {
  const blockTexts = getBlockTexts(value);
  const fullText = blockTexts.join("\n");

  const match = matchQuote(fullText, selector.exact, {
    prefix: selector.prefix,
    suffix: selector.suffix,
  });

  if (!match) return null;

  const startPos = globalOffsetToBlockPosition(blockTexts, match.start);
  const endPos = globalOffsetToBlockPosition(blockTexts, match.end);

  return {
    startBlock: startPos.blockIndex,
    startOffset: startPos.offset,
    endBlock: endPos.blockIndex,
    endOffset: endPos.offset,
  };
}

/**
 * Apply comment marks to the Slate tree by matching selectors.
 */
function applyCommentMarksBySelector(
  value: any[],
  discussions: TDiscussion[],
  selectorMap: Map<string, TextQuoteSelector>,
) {
  for (const discussion of discussions) {
    const selector = selectorMap.get(discussion.id);
    if (!selector) continue;

    const range = findTextWithSelector(value, selector);
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

    // Serialize discussions to frontmatter
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

    // Serialize discussions to frontmatter
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
    if (!editor || !filePath || isExternal || !initialLoadCompleteRef.current)
      return;

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
                selectorMap: Map<string, TextQuoteSelector>;
              }
            | undefined;

          if (
            parsed.data.discussions &&
            Array.isArray(parsed.data.discussions)
          ) {
            discussionState = deserializeDiscussions(parsed.data.discussions);
          }

          const ed = createPlateEditor({
            plugins: editorPlugins,
            value: (editor) => {
              const nodes = editor
                .getApi(MarkdownPlugin)
                .markdown.deserialize(parsed.content);

              // Apply comment marks directly into the value before editor mounts
              if (discussionState) {
                applyCommentMarksBySelector(
                  nodes,
                  discussionState.discussions,
                  discussionState.selectorMap,
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
    if (currentTop !== savedUndoRef.current) {
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
