import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ArrowUp, ChevronDown, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/store/agent-store";

const MAX_ROWS = 6;

export function ChatInput() {
  const connectionStatus = useAgentStore((s) => s.connectionStatus);
  const inputText = useAgentStore((s) => s.inputText);
  const availableModes = useAgentStore((s) => s.availableModes);
  const currentModeId = useAgentStore((s) => s.currentModeId);
  const availableCommands = useAgentStore((s) => s.availableCommands);
  const isResponding = useAgentStore((s) => s.isResponding);
  const setInputText = useAgentStore((s) => s.setInputText);
  const setCurrentModeId = useAgentStore((s) => s.setCurrentModeId);
  const sendPrompt = useAgentStore((s) => s.sendPrompt);
  const cancelPrompt = useAgentStore((s) => s.cancelPrompt);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);

  const disabled = connectionStatus !== "connected";

  const slashQuery = useMemo(() => {
    if (!inputText.startsWith("/")) return null;
    if (inputText.includes("\n")) return null;
    const firstLine = inputText.split("\n")[0];
    if (firstLine.includes(" ")) return null;
    return firstLine.slice(1).toLowerCase();
  }, [inputText]);

  const filteredCommands = useMemo(() => {
    if (slashQuery === null) return [];
    return availableCommands.filter(
      (command) =>
        command.name.toLowerCase().includes(slashQuery) ||
        command.description.toLowerCase().includes(slashQuery),
    );
  }, [availableCommands, slashQuery]);

  const showSlashMenu = slashQuery !== null && filteredCommands.length > 0;

  useEffect(() => {
    setSelectedCommandIndex(0);
  }, [slashQuery, filteredCommands.length]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "0px";
    const lineHeight = Number.parseInt(
      globalThis.getComputedStyle(textarea).lineHeight || "20",
      10,
    );
    const maxHeight = lineHeight * MAX_ROWS + 16;
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [inputText]);

  const applySlashCommand = (commandName: string) => {
    setInputText(`/${commandName} `);
    textareaRef.current?.focus();
  };

  const submitPrompt = () => {
    if (disabled || isResponding) return;
    const text = inputText.trim();
    if (!text) return;
    void sendPrompt(text);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "ArrowDown" && showSlashMenu) {
      event.preventDefault();
      setSelectedCommandIndex((index) =>
        Math.min(index + 1, filteredCommands.length - 1),
      );
      return;
    }
    if (event.key === "ArrowUp" && showSlashMenu) {
      event.preventDefault();
      setSelectedCommandIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      if (showSlashMenu) {
        event.preventDefault();
        const selected = filteredCommands[selectedCommandIndex];
        if (selected) {
          applySlashCommand(selected.name);
        }
        return;
      }
      event.preventDefault();
      submitPrompt();
      return;
    }
    if (event.key === "Escape" && showSlashMenu) {
      event.preventDefault();
      setInputText(inputText.endsWith(" ") ? inputText : `${inputText} `);
    }
  };

  const currentMode = availableModes.find((mode) => mode.id === currentModeId);

  return (
    <div className="shrink-0 border-t border-border/60 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
            >
              <span className="truncate max-w-[12rem]">
                {currentMode?.name ?? "mode"}
              </span>
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-52">
            {availableModes.length === 0 ? (
              <DropdownMenuItem disabled>no modes available</DropdownMenuItem>
            ) : (
              availableModes.map((mode) => (
                <DropdownMenuItem
                  key={mode.id}
                  onClick={() => setCurrentModeId(mode.id)}
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="truncate">{mode.name}</span>
                    {mode.description && (
                      <span className="text-xs text-muted-foreground truncate">
                        {mode.description}
                      </span>
                    )}
                  </div>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="relative">
        {showSlashMenu && (
          <div className="absolute bottom-[calc(100%+0.5rem)] left-0 right-0 rounded-md border border-border/70 bg-background shadow-lg max-h-48 overflow-y-auto z-20 p-1">
            {filteredCommands.map((command, index) => (
              <button
                key={command.name}
                type="button"
                className={cn(
                  "w-full text-left px-2 py-1.5 rounded text-sm transition-colors",
                  index === selectedCommandIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted/60 text-foreground",
                )}
                onMouseDown={(event) => {
                  event.preventDefault();
                  applySlashCommand(command.name);
                }}
              >
                <div className="font-medium truncate">/{command.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {command.description}
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="relative">
          <Textarea
            id="agent-chat-input"
            ref={textareaRef}
            value={inputText}
            disabled={disabled}
            placeholder={
              disabled
                ? "connect an agent to start chatting..."
                : "Type a message..."
            }
            className="min-h-[44px] max-h-52 pr-12 resize-none"
            onChange={(event) => setInputText(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <Button
            type="button"
            size="icon-sm"
            variant={isResponding ? "destructive" : "default"}
            disabled={disabled}
            className="absolute right-1.5 bottom-1.5"
            onClick={() =>
              isResponding ? void cancelPrompt() : submitPrompt()
            }
          >
            {isResponding ? (
              <Square className="h-3.5 w-3.5" />
            ) : (
              <ArrowUp className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
