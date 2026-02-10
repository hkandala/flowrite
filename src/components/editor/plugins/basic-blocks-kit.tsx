import {
  BlockquotePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  H4Plugin,
  H5Plugin,
  H6Plugin,
  HorizontalRulePlugin,
} from "@platejs/basic-nodes/react";
import type { Path, TElement } from "platejs";
import { KEYS, PathApi } from "platejs";
import type { PlateEditor } from "platejs/react";
import { ParagraphPlugin } from "platejs/react";

import { BlockquoteElement } from "@/components/ui/blockquote-node";
import {
  H1Element,
  H2Element,
  H3Element,
  H4Element,
  H5Element,
  H6Element,
} from "@/components/ui/heading-node";
import { HrElement } from "@/components/ui/hr-node";
import { ParagraphElement } from "@/components/ui/paragraph-node";

import { TodoViewPlugin } from "@/components/editor/plugins/todo-view-plugin";

// helper to scroll the selected node into view (for section jumps - scrolls to top)
function scrollToSelection(editor: PlateEditor, path: Path) {
  setTimeout(() => {
    try {
      const node = editor.api.node(path);
      if (node) {
        const domNode = editor.api.toDOMNode(node[0]);
        if (domNode) {
          const scrollContainer = domNode.closest(
            '[data-slot="scroll-area-viewport"]',
          );
          if (scrollContainer) {
            const containerRect = scrollContainer.getBoundingClientRect();
            const nodeRect = domNode.getBoundingClientRect();
            const scrollTop =
              scrollContainer.scrollTop + (nodeRect.top - containerRect.top);
            scrollContainer.scrollTo({ top: scrollTop });
          } else {
            domNode.scrollIntoView({ block: "start" });
          }
        }
      }
    } catch {
      // fallback: do nothing if DOM node not found
    }
  }, 0);
}

// helper to check if a block should be skipped in navigation
// (hidden checked todos, or HR separators)
export function shouldSkipBlock(editor: PlateEditor, index: number): boolean {
  const block = editor.children[index] as TElement & {
    type?: string;
    listStyleType?: string;
    checked?: boolean;
  };
  if (!block) return false;

  // skip HR elements (section separators)
  if (block.type === KEYS.hr) return true;

  // skip hidden checked todos
  const hideChecked = editor.getOptions(TodoViewPlugin).hideChecked;
  const isTodo = block.listStyleType === "todo";
  const isChecked = block.checked === true;

  return isTodo && hideChecked && isChecked;
}

// block navigation - jump to next visible block (no cycling, skips hidden items)
export function jumpToNextBlock(editor: PlateEditor) {
  const selection = editor.selection;
  if (!selection) return;

  const currentIndex = selection.anchor.path[0];
  const totalBlocks = editor.children.length;

  // find next visible block (no wrap around)
  for (let i = currentIndex + 1; i < totalBlocks; i++) {
    if (!shouldSkipBlock(editor, i)) {
      const nextPath: Path = [i];
      editor.tf.select(nextPath);
      editor.tf.collapse({ edge: "start" });
      return;
    }
  }
  // no more visible blocks - do nothing
}

export function jumpToPrevBlock(editor: PlateEditor) {
  const selection = editor.selection;
  if (!selection) return;

  const currentIndex = selection.anchor.path[0];

  // find previous visible block (no wrap around)
  for (let i = currentIndex - 1; i >= 0; i--) {
    if (!shouldSkipBlock(editor, i)) {
      const prevPath: Path = [i];
      editor.tf.select(prevPath);
      editor.tf.collapse({ edge: "start" });
      return;
    }
  }
  // no more visible blocks - do nothing
}

// move to next visible block, or previous if at end
export function moveToAdjacentBlock(editor: PlateEditor) {
  const selection = editor.selection;
  if (!selection) return;

  const currentIndex = selection.anchor.path[0];
  const hasNext = currentIndex < editor.children.length - 1;

  if (hasNext) {
    jumpToNextBlock(editor);
  } else {
    jumpToPrevBlock(editor);
  }
}

// get the index of the first visible (non-skipped) block
export function getFirstVisibleBlockIndex(editor: PlateEditor): number {
  const totalBlocks = editor.children.length;

  for (let i = 0; i < totalBlocks; i++) {
    if (!shouldSkipBlock(editor, i)) {
      return i;
    }
  }

  // fallback to first block if all are hidden (shouldn't happen)
  return 0;
}

// helper to get all HR paths in document order
function getHrPaths(editor: PlateEditor): Path[] {
  return Array.from(
    editor.api.nodes({
      at: [],
      match: { type: editor.getType(KEYS.hr) },
    }) as Iterable<[TElement, Path]>,
  ).map(([, path]) => path);
}

// helper to get the last path in the document
function getLastPath(editor: PlateEditor): Path {
  const children = editor.children;
  return [children.length - 1];
}

// exported for use in command palette
export function jumpToNextSection(editor: PlateEditor) {
  const selection = editor.selection;
  if (!selection) return;

  const currentPath = selection.anchor.path.slice(0, 1);
  const hrPaths = getHrPaths(editor);

  // if no HRs exist, jump to end of document
  if (hrPaths.length === 0) {
    const lastPath = getLastPath(editor);
    editor.tf.select(lastPath);
    editor.tf.collapse({ edge: "end" });
    scrollToSelection(editor, lastPath);
    return;
  }

  // find the first HR that is after or at current position
  for (const hrPath of hrPaths) {
    // use isAfter OR equals to handle when cursor is at start of section
    if (
      PathApi.isAfter(hrPath, currentPath) ||
      PathApi.equals(hrPath, currentPath)
    ) {
      const nextPath = PathApi.next(hrPath);
      if (editor.api.hasPath(nextPath)) {
        editor.tf.select(nextPath);
        editor.tf.collapse({ edge: "start" });
        scrollToSelection(editor, nextPath);
        return;
      }
    }
  }

  // no more HRs after current position, jump to end of document
  const lastPath = getLastPath(editor);
  editor.tf.select(lastPath);
  editor.tf.collapse({ edge: "end" });
  scrollToSelection(editor, lastPath);
}

export function jumpToPrevSection(editor: PlateEditor) {
  const selection = editor.selection;
  if (!selection) return;

  const currentPath = selection.anchor.path.slice(0, 1);
  const hrPaths = getHrPaths(editor);

  // if no HRs exist, jump to start of document
  if (hrPaths.length === 0) {
    editor.tf.select([0]);
    editor.tf.collapse({ edge: "start" });
    scrollToSelection(editor, [0]);
    return;
  }

  // check if cursor is at the element right after an HR
  // if so, we need to skip that HR and go to the previous one
  let targetHrPath: Path | null = null;

  for (let i = hrPaths.length - 1; i >= 0; i--) {
    const hrPath = hrPaths[i];
    const afterHrPath = PathApi.next(hrPath);

    // if current position is right after this HR, look for the previous HR
    if (PathApi.equals(afterHrPath, currentPath)) {
      // find the HR before this one
      if (i > 0) {
        targetHrPath = hrPaths[i - 1];
      } else {
        // no previous HR, go to start
        editor.tf.select([0]);
        editor.tf.collapse({ edge: "start" });
        scrollToSelection(editor, [0]);
        return;
      }
      break;
    }

    // if this HR is strictly before current position
    if (PathApi.isBefore(hrPath, currentPath)) {
      targetHrPath = hrPath;
      break;
    }
  }

  if (targetHrPath) {
    const nextPath = PathApi.next(targetHrPath);
    if (editor.api.hasPath(nextPath)) {
      editor.tf.select(nextPath);
      editor.tf.collapse({ edge: "start" });
      scrollToSelection(editor, nextPath);
      return;
    }
  }

  // no HR before current position, go to start of document
  editor.tf.select([0]);
  editor.tf.collapse({ edge: "start" });
  scrollToSelection(editor, [0]);
}

export const BasicBlocksKit = [
  ParagraphPlugin.configure({
    node: { component: ParagraphElement },
    shortcuts: {
      jumpToNextBlock: {
        keys: "mod+alt+j",
        handler: (ctx) => jumpToNextBlock(ctx.editor),
      },
      jumpToPrevBlock: {
        keys: "mod+alt+k",
        handler: (ctx) => jumpToPrevBlock(ctx.editor),
      },
    },
  }),
  H1Plugin.configure({
    node: {
      component: H1Element,
    },
    rules: {
      break: { empty: "reset" },
    },
    shortcuts: { toggle: { keys: "mod+alt+1" } },
  }),
  H2Plugin.configure({
    node: {
      component: H2Element,
    },
    rules: {
      break: { empty: "reset" },
    },
    shortcuts: { toggle: { keys: "mod+alt+2" } },
  }),
  H3Plugin.configure({
    node: {
      component: H3Element,
    },
    rules: {
      break: { empty: "reset" },
    },
    shortcuts: { toggle: { keys: "mod+alt+3" } },
  }),
  H4Plugin.configure({
    node: {
      component: H4Element,
    },
    rules: {
      break: { empty: "reset" },
    },
    shortcuts: { toggle: { keys: "mod+alt+4" } },
  }),
  H5Plugin.configure({
    node: {
      component: H5Element,
    },
    rules: {
      break: { empty: "reset" },
    },
    shortcuts: { toggle: { keys: "mod+alt+5" } },
  }),
  H6Plugin.configure({
    node: {
      component: H6Element,
    },
    rules: {
      break: { empty: "reset" },
    },
    shortcuts: { toggle: { keys: "mod+alt+6" } },
  }),
  BlockquotePlugin.configure({
    node: { component: BlockquoteElement },
  }),
  HorizontalRulePlugin.configure({
    node: { component: HrElement },
    shortcuts: {
      jumpToNextSection: {
        keys: "mod+alt+l",
        handler: (ctx) => jumpToNextSection(ctx.editor),
      },
      jumpToPrevSection: {
        keys: "mod+alt+h",
        handler: (ctx) => jumpToPrevSection(ctx.editor),
      },
    },
  }),
];
