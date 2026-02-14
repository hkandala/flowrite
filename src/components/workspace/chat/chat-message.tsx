import { useMemo } from "react";

import { createSlateEditor } from "platejs";
import { BaseParagraphPlugin } from "platejs";

import type { ChatMessage as ChatMessageType } from "@/store/agent-store";
import { FileReferencePlugin } from "@/components/chat/plugins/file-reference-plugin";
import { FileReferenceElementStatic } from "@/components/chat/ui/file-reference-node-static";
import { EditorStatic } from "@/components/ui/editor-static";
import { ParagraphElementStatic } from "@/components/ui/paragraph-node-static";

import { ChatMarkdown } from "./chat-markdown";

import { PlanBlock } from "./plan-block";
import { ThinkingBar } from "./thinking-bar";
import { ToolCallBlock } from "./tool-call-block";

const userMessagePlugins = [
  BaseParagraphPlugin.withComponent(ParagraphElementStatic),
  FileReferencePlugin.withComponent(FileReferenceElementStatic),
];

function UserMessageStatic({ editorValue }: { editorValue: any[] }) {
  const editor = useMemo(
    () => createSlateEditor({ plugins: userMessagePlugins }),
    [],
  );

  return <EditorStatic editor={editor} value={editorValue} variant="relaxed" />;
}

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="w-full rounded-lg border border-border bg-muted/35 p-3 text-sm text-foreground whitespace-pre-wrap wrap-break-word shadow-lg">
        <UserMessageStatic editorValue={message.editorValue ?? []} />
      </div>
    );
  }

  const hasSegments = message.segments.length > 0;

  return (
    <div className="space-y-2 py-3">
      <ThinkingBar
        thinking={message.thinking}
        isStreaming={message.isStreaming}
        thinkingStartedAt={message.thinkingStartedAt}
      />
      <PlanBlock entries={message.plan} />
      {hasSegments
        ? message.segments.map((segment, index) => {
            if (segment.type === "toolCall") {
              const toolCall = message.toolCalls.find(
                (tc) => tc.id === segment.toolCallId,
              );
              if (!toolCall) return null;
              return <ToolCallBlock key={toolCall.id} toolCall={toolCall} />;
            }
            return (
              <div
                key={`text-${index}`}
                className="text-sm text-foreground wrap-break-word px-1.5 py-1"
              >
                <ChatMarkdown>{segment.content}</ChatMarkdown>
              </div>
            );
          })
        : message.toolCalls.map((toolCall) => (
            <ToolCallBlock key={toolCall.id} toolCall={toolCall} />
          ))}
      {!hasSegments && (message.content || message.isStreaming) && (
        <div className="text-sm text-foreground wrap-break-word px-1.5">
          {message.content ? (
            <ChatMarkdown>{message.content}</ChatMarkdown>
          ) : (
            message.isStreaming && (
              <span className="bg-[linear-gradient(to_right,var(--muted-foreground)_40%,var(--foreground)_60%,var(--muted-foreground)_80%)] bg-size-[200%_auto] bg-clip-text font-medium text-transparent animate-[shimmer_4s_infinite_linear] text-sm">
                thinking...
              </span>
            )
          )}
        </div>
      )}
      {hasSegments &&
        message.isStreaming &&
        message.segments[message.segments.length - 1]?.type !== "text" &&
        !message.content && (
          <div className="text-sm text-foreground wrap-break-word px-1.5">
            <span className="bg-[linear-gradient(to_right,var(--muted-foreground)_40%,var(--foreground)_60%,var(--muted-foreground)_80%)] bg-size-[200%_auto] bg-clip-text font-medium text-transparent animate-[shimmer_4s_infinite_linear] text-sm">
              thinking...
            </span>
          </div>
        )}
    </div>
  );
}
