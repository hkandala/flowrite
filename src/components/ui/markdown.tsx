import { cn } from "@/lib/utils";
import { marked } from "marked";
import { memo, useId, useMemo } from "react";
import ReactMarkdown, { Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { CodeBlock, CodeBlockCode } from "@/components/ui/code-block";

export type MarkdownProps = {
  children: string;
  id?: string;
  className?: string;
  components?: Partial<Components>;
};

function parseMarkdownIntoBlocks(markdown: string): string[] {
  const tokens = marked.lexer(markdown);
  return tokens.map((token) => token.raw);
}

function extractLanguage(className?: string): string {
  if (!className) return "plaintext";
  const match = className.match(/language-(\w+)/);
  return match ? match[1] : "plaintext";
}

const INITIAL_COMPONENTS: Partial<Components> = {
  code: function CodeComponent({ className, children, node, ref, ...props }) {
    const isInline =
      !node?.position?.start.line ||
      node?.position?.start.line === node?.position?.end.line;

    if (isInline) {
      return (
        <span
          className={cn(
            "bg-primary-foreground rounded-sm px-1 font-mono text-sm",
            className,
          )}
          {...props}
        >
          {children}
        </span>
      );
    }

    const language = extractLanguage(className);

    return (
      <CodeBlock className={className}>
        <CodeBlockCode code={children as string} language={language} />
      </CodeBlock>
    );
  },
  pre: function PreComponent({ children }) {
    return <>{children}</>;
  },
  p: function ParagraphComponent({ children }) {
    return <p className="mb-2 last:mb-0">{children}</p>;
  },
  ul: function UlComponent({ children }) {
    return <ul className="mb-2 list-disc list-inside last:mb-0">{children}</ul>;
  },
  ol: function OlComponent({ children }) {
    return (
      <ol className="mb-2 list-decimal list-inside last:mb-0">{children}</ol>
    );
  },
  li: function LiComponent({ children }) {
    return <li className="mb-0.5">{children}</li>;
  },
  h1: function H1Component({ children }) {
    return <h1 className="mb-2 text-lg font-semibold">{children}</h1>;
  },
  h2: function H2Component({ children }) {
    return <h2 className="mb-2 text-base font-semibold">{children}</h2>;
  },
  h3: function H3Component({ children }) {
    return <h3 className="mb-1.5 text-sm font-semibold">{children}</h3>;
  },
  blockquote: function BlockquoteComponent({ children }) {
    return (
      <blockquote className="mb-2 border-l-2 border-border pl-3 text-muted-foreground">
        {children}
      </blockquote>
    );
  },
  table: function TableComponent({ children }) {
    return (
      <div className="mb-2 overflow-x-auto">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    );
  },
  thead: function TheadComponent({ children }) {
    return <thead className="border-b border-border/60">{children}</thead>;
  },
  th: function ThComponent({ children }) {
    return (
      <th className="border border-border/60 px-2 py-1 text-left font-medium">
        {children}
      </th>
    );
  },
  td: function TdComponent({ children }) {
    return <td className="border border-border/60 px-2 py-1">{children}</td>;
  },
  hr: function HrComponent() {
    return <hr className="my-3 border-border/60" />;
  },
  a: function AComponent({ children, href }) {
    return (
      <a
        href={href}
        className="text-primary underline underline-offset-2"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  },
  strong: function StrongComponent({ children }) {
    return <strong className="font-semibold">{children}</strong>;
  },
};

const MemoizedMarkdownBlock = memo(
  function MarkdownBlock({
    content,
    components = INITIAL_COMPONENTS,
  }: {
    content: string;
    components?: Partial<Components>;
  }) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    );
  },
  function propsAreEqual(prevProps, nextProps) {
    return prevProps.content === nextProps.content;
  },
);

MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock";

function MarkdownComponent({
  children,
  id,
  className,
  components = INITIAL_COMPONENTS,
}: MarkdownProps) {
  const generatedId = useId();
  const blockId = id ?? generatedId;
  const blocks = useMemo(() => parseMarkdownIntoBlocks(children), [children]);

  return (
    <div className={className}>
      {blocks.map((block, index) => (
        <MemoizedMarkdownBlock
          key={`${blockId}-block-${index}`}
          content={block}
          components={components}
        />
      ))}
    </div>
  );
}

const Markdown = memo(MarkdownComponent);
Markdown.displayName = "Markdown";

export { Markdown };
