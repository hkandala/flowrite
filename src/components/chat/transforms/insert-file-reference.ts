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
  },
) {
  const node: TFileReferenceElement = {
    type: FILE_REFERENCE_TYPE,
    filePath: opts.filePath,
    displayName: opts.displayName,
    lineStart: opts.lineStart,
    lineEnd: opts.lineEnd,
    children: [{ text: "" }],
  };

  editor.tf.insertNodes(node);
  editor.tf.move();
  editor.tf.focus({ edge: "end" });
  editor.tf.insertText(" ");
}
