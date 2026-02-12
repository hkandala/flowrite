import { cn } from "@/lib/utils";
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
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg border border-border/70 bg-muted/35 px-3 py-2 text-sm text-foreground whitespace-pre-wrap break-words">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <ThinkingBar thinking={message.thinking} />
      <PlanBlock entries={message.plan} />
      {message.toolCalls.map((toolCall) => (
        <ToolCallBlock key={toolCall.id} toolCall={toolCall} />
      ))}
      {(message.content || message.isStreaming) && (
        <div
          className={cn(
            "text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed",
            message.isStreaming &&
              "after:content-['▎'] after:ml-0.5 after:animate-pulse",
          )}
        >
          {message.content}
        </div>
      )}
    </div>
  );
}
