import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { ArrowUp, ChevronDown, Square } from "lucide-react";
import TextareaAutosize from "react-textarea-autosize";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group";
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

  const applySlashCommand = (commandName: string) => {
    setInputText(`/${commandName} `);
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
    <div className="shrink-0 pr-3 pb-4">
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

        <InputGroup className="bg-transparent dark:bg-transparent rounded-xl">
          <TextareaAutosize
            data-slot="input-group-control"
            className="field-sizing-content min-h-15 w-full resize-none rounded-md bg-transparent p-4 text-sm transition-[color,box-shadow] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            value={inputText}
            disabled={disabled}
            placeholder={
              disabled
                ? "connect an agent to start chatting..."
                : "type a message..."
            }
            maxRows={MAX_ROWS}
            onChange={(event) => setInputText(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <InputGroupAddon align="block-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <InputGroupButton size="sm" variant="ghost" disabled={disabled}>
                  <span className="truncate max-w-48">
                    {currentMode?.name ?? "mode"}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </InputGroupButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-52 max-w-72">
                {availableModes.length === 0 ? (
                  <DropdownMenuItem disabled>
                    no modes available
                  </DropdownMenuItem>
                ) : (
                  availableModes.map((mode) => (
                    <DropdownMenuItem
                      key={mode.id}
                      onClick={() => setCurrentModeId(mode.id)}
                    >
                      <div className="flex flex-col gap-0.5 min-w-0 overflow-hidden">
                        <span className="truncate">{mode.name}</span>
                        {mode.description && (
                          <span className="text-xs text-muted-foreground line-clamp-2">
                            {mode.description}
                          </span>
                        )}
                      </div>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <InputGroupButton
              className="ml-auto"
              size="icon-sm"
              variant="default"
              disabled={disabled}
              onClick={() =>
                isResponding ? void cancelPrompt() : submitPrompt()
              }
            >
              {isResponding ? (
                <Square className="h-3.5 w-3.5" />
              ) : (
                <ArrowUp className="h-3.5 w-3.5" />
              )}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  );
}
