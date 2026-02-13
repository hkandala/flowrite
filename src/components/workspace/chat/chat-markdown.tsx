import { useEffect, useMemo, useRef, useState } from "react";

import { MarkdownPlugin } from "@platejs/markdown";
import { createSlateEditor } from "platejs";

import { BaseBasicBlocksKit } from "@/components/editor/plugins/basic-blocks-base-kit";
import { BaseBasicMarksKit } from "@/components/editor/plugins/basic-marks-base-kit";
import { BaseCodeBlockKit } from "@/components/editor/plugins/code-block-base-kit";
import { BaseLinkKit } from "@/components/editor/plugins/link-base-kit";
import { BaseListKit } from "@/components/editor/plugins/list-base-kit";
import { BaseTableKit } from "@/components/editor/plugins/table-base-kit";
import { MarkdownKit } from "@/components/editor/plugins/markdown-kit";
import { EditorStatic } from "@/components/ui/editor-static";

const chatPlugins = [
  ...BaseBasicBlocksKit,
  ...BaseBasicMarksKit,
  ...BaseCodeBlockKit,
  ...BaseLinkKit,
  ...BaseListKit,
  ...BaseTableKit,
  ...MarkdownKit,
];

const THROTTLE_MS = 150;

interface ChatMarkdownProps {
  children: string;
}

const normalizeMarkdown = (content: string): string =>
  content.trim().replace(/\n{3,}/g, "\n\n");

export function ChatMarkdown({ children }: ChatMarkdownProps) {
  const editor = useMemo(() => createSlateEditor({ plugins: chatPlugins }), []);

  const [value, setValue] = useState(() =>
    editor.getApi(MarkdownPlugin).markdown.deserialize(normalizeMarkdown(children)),
  );

  const lastUpdateRef = useRef(Date.now());
  const lastContentRef = useRef(children);
  const lastDeserializedRef = useRef(children);

  useEffect(() => {
    if (children === lastDeserializedRef.current) return;

    lastContentRef.current = children;

    const now = Date.now();
    const elapsed = now - lastUpdateRef.current;

    // Enough time has passed — update immediately
    if (elapsed >= THROTTLE_MS) {
      lastUpdateRef.current = now;
      lastDeserializedRef.current = children;
      setValue(editor.getApi(MarkdownPlugin).markdown.deserialize(normalizeMarkdown(children)));
      return;
    }

    // Schedule a trailing update to guarantee final content renders
    const id = setTimeout(() => {
      const content = lastContentRef.current;
      lastUpdateRef.current = Date.now();
      lastDeserializedRef.current = content;
      setValue(editor.getApi(MarkdownPlugin).markdown.deserialize(normalizeMarkdown(content)));
    }, THROTTLE_MS - elapsed);

    return () => clearTimeout(id);
  }, [children, editor]);

  return <EditorStatic editor={editor} value={value} variant="ai" />;
}
