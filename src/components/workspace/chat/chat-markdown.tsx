import {
  memo,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { MarkdownPlugin, remarkMdx } from "@platejs/markdown";
import { KEYS, createSlateEditor } from "platejs";
import remarkGfm from "remark-gfm";

import { BaseBasicBlocksKit } from "@/components/editor/plugins/basic-blocks-base-kit";
import { BaseBasicMarksKit } from "@/components/editor/plugins/basic-marks-base-kit";
import { BaseCodeBlockKit } from "@/components/editor/plugins/code-block-base-kit";
import { BaseLinkKit } from "@/components/editor/plugins/link-base-kit";
import { BaseListKit } from "@/components/editor/plugins/list-base-kit";
import { BaseTableKit } from "@/components/editor/plugins/table-base-kit";
import { EditorStatic } from "@/components/ui/editor-static";

const ChatMarkdownKit = [
  MarkdownPlugin.configure({
    options: {
      disallowedNodes: [KEYS.suggestion],
      remarkPlugins: [remarkGfm, remarkMdx],
    },
  }),
];

const chatPlugins = [
  ...BaseBasicBlocksKit,
  ...BaseBasicMarksKit,
  ...BaseCodeBlockKit,
  ...BaseLinkKit,
  ...BaseListKit,
  ...BaseTableKit,
  ...ChatMarkdownKit,
];

const THROTTLE_MS = 150;

interface ChatMarkdownProps {
  children: string;
}

const normalizeMarkdown = (content: string): string =>
  content.trim().replace(/\n{3,}/g, "\n\n");

export const ChatMarkdown = memo(function ChatMarkdown({
  children,
}: ChatMarkdownProps) {
  const editor = useMemo(() => createSlateEditor({ plugins: chatPlugins }), []);

  const [value, setValue] = useState(() =>
    editor
      .getApi(MarkdownPlugin)
      .markdown.deserialize(normalizeMarkdown(children)),
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
      const deserialized = editor
        .getApi(MarkdownPlugin)
        .markdown.deserialize(normalizeMarkdown(children));
      startTransition(() => setValue(deserialized));
      return;
    }

    // Schedule a trailing update to guarantee final content renders
    const id = setTimeout(() => {
      const content = lastContentRef.current;
      lastUpdateRef.current = Date.now();
      lastDeserializedRef.current = content;
      const deserialized = editor
        .getApi(MarkdownPlugin)
        .markdown.deserialize(normalizeMarkdown(content));
      startTransition(() => setValue(deserialized));
    }, THROTTLE_MS - elapsed);

    return () => clearTimeout(id);
  }, [children, editor]);

  return (
    <EditorStatic
      editor={editor}
      value={value}
      variant="relaxed"
      className="space-y-2 [&_li]:my-0.5"
    />
  );
});
