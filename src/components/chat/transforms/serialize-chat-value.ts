import { FILE_REFERENCE_TYPE } from "../plugins/file-reference-plugin";
import type { TFileReferenceElement } from "../plugins/file-reference-plugin";

/**
 * Serialize Plate editor value to plain text.
 * File reference elements become Zed-style syntax:
 * `[@displayName#L12:13](file:///path#L12:13)`
 */
export function serializeChatValue(value: any[]): string {
  return value.map((block) => serializeBlock(block)).join("\n");
}

function serializeBlock(block: any): string {
  if (!block.children) return "";
  return block.children.map((child: any) => serializeNode(child)).join("");
}

function serializeNode(node: any): string {
  if (node.type === FILE_REFERENCE_TYPE) {
    const el = node as TFileReferenceElement;
    const lineRange =
      el.lineStart != null
        ? el.lineEnd != null && el.lineEnd !== el.lineStart
          ? `#L${el.lineStart}:${el.lineEnd}`
          : `#L${el.lineStart}`
        : "";
    return `[@${el.displayName}${lineRange}](file://${el.filePath}${lineRange})`;
  }

  // text node
  if (node.text != null) {
    return node.text as string;
  }

  // any other element — recurse
  if (node.children) {
    return serializeBlock(node);
  }

  return "";
}
