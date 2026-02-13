import type { TElement } from "platejs";
import { createPlatePlugin } from "platejs/react";

export const FILE_REFERENCE_TYPE = "file_reference";

export interface TFileReferenceElement extends TElement {
  type: typeof FILE_REFERENCE_TYPE;
  filePath: string;
  displayName: string;
  lineStart?: number;
  lineEnd?: number;
  children: [{ text: "" }];
}

export const FileReferencePlugin = createPlatePlugin({
  key: FILE_REFERENCE_TYPE,
  node: {
    isElement: true,
    isInline: true,
    isVoid: true,
    type: FILE_REFERENCE_TYPE,
  },
});
