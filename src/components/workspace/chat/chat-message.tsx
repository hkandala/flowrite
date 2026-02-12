import { Markdown } from "@/components/ui/markdown";
import type { ChatMessage as ChatMessageType } from "@/store/agent-store";

import { PlanBlock } from "./plan-block";
import { ThinkingBar } from "./thinking-bar";
import { ToolCallBlock } from "./tool-call-block";

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="w-full rounded-lg border border-border/70 bg-muted/35 px-2.5 py-2 text-sm text-foreground whitespace-pre-wrap wrap-break-word">
        {message.content}
      </div>
    );
  }

  const hasSegments = message.segments.length > 0;

  return (
    <div className="space-y-2">
      <ThinkingBar
        thinking={message.thinking}
        isStreaming={message.isStreaming}
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
                className="text-sm text-foreground wrap-break-word leading-relaxed px-1.5"
              >
                <Markdown>{segment.content}</Markdown>
              </div>
            );
          })
        : message.toolCalls.map((toolCall) => (
            <ToolCallBlock key={toolCall.id} toolCall={toolCall} />
          ))}
      {!hasSegments && (message.content || message.isStreaming) && (
        <div className="text-sm text-foreground wrap-break-word leading-relaxed px-1.5">
          {message.content ? (
            <Markdown>{message.content}</Markdown>
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
          <div className="text-sm text-foreground wrap-break-word leading-relaxed px-1.5">
            <span className="bg-[linear-gradient(to_right,var(--muted-foreground)_40%,var(--foreground)_60%,var(--muted-foreground)_80%)] bg-size-[200%_auto] bg-clip-text font-medium text-transparent animate-[shimmer_4s_infinite_linear] text-sm">
              thinking...
            </span>
          </div>
        )}
    </div>
  );
}
