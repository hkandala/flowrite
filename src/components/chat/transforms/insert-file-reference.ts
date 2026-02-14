import type { PlateEditor } from "platejs/react";

import {
  FILE_REFERENCE_TYPE,
  type TFileReferenceElement,
} from "../plugins/file-reference-plugin";

export function insertFileReference(
  editor: PlateEditor,
  opts: {
    filePath: string;
    displayName: string;
    lineStart?: number;
    lineEnd?: number;
    selectedText?: string;
  },
) {
  const node: TFileReferenceElement = {
    type: FILE_REFERENCE_TYPE,
    filePath: opts.filePath,
    displayName: opts.displayName,
    lineStart: opts.lineStart,
    lineEnd: opts.lineEnd,
    ...(opts.selectedText ? { selectedText: opts.selectedText } : {}),
    children: [{ text: "" }],
  };

  // Determine if we need spaces around the chip based on surrounding text
  let addLeftSpace = false;
  let addRightSpace = true;

  const { selection } = editor;
  if (selection) {
    const { anchor } = selection;
    const entry = editor.api.node(anchor.path);

    if (entry?.[0] && "text" in entry[0]) {
      const text = entry[0].text as string;

      // Check left: add space unless at start of text node with no prior
      // content, or if the previous character is already a space
      if (anchor.offset > 0) {
        addLeftSpace = text[anchor.offset - 1] !== " ";
      } else {
        // At offset 0 — only add left space if there's content before
        // this text node (e.g. another chip)
        const before = editor.api.before(anchor);
        addLeftSpace = before != null;
      }

      // Check right: skip space if the next character is already a space
      if (anchor.offset < text.length && text[anchor.offset] === " ") {
        addRightSpace = false;
      }
    }
  }

  if (addLeftSpace) editor.tf.insertText(" ");
  editor.tf.insertNodes(node);
  editor.tf.move();
  if (addRightSpace) editor.tf.insertText(" ");
  editor.tf.focus({ edge: "end" });
}
