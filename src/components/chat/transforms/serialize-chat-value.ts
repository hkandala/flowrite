import { FILE_REFERENCE_TYPE } from "../plugins/file-reference-plugin";
import type { TFileReferenceElement } from "../plugins/file-reference-plugin";
import type { OpenFileInfo } from "@/store/workspace-store";

type FileRefClassification = "no-text" | "inline" | "context-block";

interface ClassifiedRef {
  el: TFileReferenceElement;
  classification: FileRefClassification;
  contextId?: number;
}

function formatLines(el: TFileReferenceElement): string {
  if (el.lineStart == null) return "";
  if (el.lineEnd != null && el.lineEnd !== el.lineStart)
    return `${el.lineStart}:${el.lineEnd}`;
  return `${el.lineStart}`;
}

function classifyRef(el: TFileReferenceElement): FileRefClassification {
  const text = el.selectedText;
  if (!text || !text.trim()) return "no-text";

  const lines = text.split("\n");
  if (lines.length > 1) return "context-block";

  const words = text.trim().split(/\s+/);
  if (words.length > 30) return "context-block";

  return "inline";
}

/**
 * Serialize Plate editor value to a prompt string with hybrid file reference format.
 *
 * - no selectedText → `<file path="..." lines="..." />`
 * - short selectedText (≤30 words, 1 line) → `<file path="..." lines="...">text</file>`
 * - long selectedText → context block in `<attached_files>` header, `<file_ref id="N" />` inline
 */
export function serializeChatValue(value: any[]): string {
  // Pass 1: collect and classify all file references
  const classified: ClassifiedRef[] = [];
  let contextIdCounter = 0;

  for (const block of value) {
    if (!block.children) continue;
    for (const child of block.children) {
      if (child.type === FILE_REFERENCE_TYPE) {
        const el = child as TFileReferenceElement;
        const classification = classifyRef(el);
        const ref: ClassifiedRef = { el, classification };
        if (classification === "context-block") {
          contextIdCounter++;
          ref.contextId = contextIdCounter;
        }
        classified.push(ref);
      }
    }
  }

  // Build a lookup for quick access during serialization
  const refMap = new Map<TFileReferenceElement, ClassifiedRef>();
  for (const ref of classified) {
    refMap.set(ref.el, ref);
  }

  // Pass 2: build the output
  const contextRefs = classified.filter(
    (r) => r.classification === "context-block",
  );

  let header = "";
  if (contextRefs.length > 0) {
    const blocks = contextRefs.map((ref) => {
      const lines = formatLines(ref.el);
      const linesAttr = lines ? ` lines="${lines}"` : "";
      return `<file id="${ref.contextId}" path="${ref.el.filePath}"${linesAttr}>\n${ref.el.selectedText}\n</file>`;
    });
    header = `<attached_files>\n${blocks.join("\n")}\n</attached_files>\n\n`;
  }

  const body = value.map((block) => serializeBlock(block, refMap)).join("\n");

  return header + body;
}

function serializeBlock(
  block: any,
  refMap: Map<TFileReferenceElement, ClassifiedRef>,
): string {
  if (!block.children) return "";
  return block.children
    .map((child: any) => serializeNode(child, refMap))
    .join("");
}

function serializeNode(
  node: any,
  refMap: Map<TFileReferenceElement, ClassifiedRef>,
): string {
  if (node.type === FILE_REFERENCE_TYPE) {
    const el = node as TFileReferenceElement;
    const ref = refMap.get(el);
    const lines = formatLines(el);
    const linesAttr = lines ? ` lines="${lines}"` : "";

    if (!ref || ref.classification === "no-text") {
      return `<file path="${el.filePath}"${linesAttr} />`;
    }

    if (ref.classification === "inline") {
      return `<file path="${el.filePath}"${linesAttr}>${el.selectedText}</file>`;
    }

    // context-block
    return `<file_ref id="${ref.contextId}" />`;
  }

  // text node
  if (node.text != null) {
    return node.text as string;
  }

  // any other element — recurse
  if (node.children) {
    return serializeBlock(node, refMap);
  }

  return "";
}

export function serializeOpenFiles(files: OpenFileInfo[]): string {
  if (files.length === 0) return "";

  const entries = files
    .map((f) => {
      const activeAttr = f.isActive ? ' active="true"' : "";
      return `<file path="${f.filePath}"${activeAttr} />`;
    })
    .join("\n");

  return `<open_files>\n${entries}\n</open_files>`;
}
