import { ArrowUp, Check, ChevronDown, Square } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import TextareaAutosize from "react-textarea-autosize";

import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/store/agent-store";

const MAX_ROWS = 6;

interface ComboboxItem {
  id: string;
  name: string;
  description?: string;
}

function SelectorCombobox({
  items,
  selectedId,
  onSelect,
  label,
  disabled,
}: {
  items: ComboboxItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  label: string;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = items.find((item) => item.id === selectedId);

  const filtered = useMemo(() => {
    if (!search) return items;
    const query = search.toLowerCase();
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query),
    );
  }, [items, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <InputGroupButton size="sm" variant="ghost" disabled={disabled}>
          <span className="truncate max-w-48">{selected?.name ?? label}</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </InputGroupButton>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-0"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <Command>
          <CommandInput
            placeholder={`search ${label}...`}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>no {label}s found</CommandEmpty>
            {filtered.map((item) => (
              <CommandItem
                key={item.id}
                value={item.id}
                onSelect={() => {
                  onSelect(item.id);
                  setOpen(false);
                  setSearch("");
                }}
              >
                <div
                  className="flex flex-col gap-0.5 min-w-0 overflow-hidden flex-1"
                  title={item.name}
                >
                  <span className="truncate">{item.name}</span>
                  {item.description && (
                    <span className="text-xs text-muted-foreground line-clamp-2">
                      {item.description}
                    </span>
                  )}
                </div>
                {item.id === selectedId && (
                  <Check className="h-3.5 w-3.5 shrink-0" />
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function ChatInput() {
  const connectionStatus = useAgentStore((s) => s.connectionStatus);
  const inputText = useAgentStore((s) => s.inputText);
  const availableModes = useAgentStore((s) => s.availableModes);
  const currentModeId = useAgentStore((s) => s.currentModeId);
  const availableModels = useAgentStore((s) => s.availableModels);
  const currentModelId = useAgentStore((s) => s.currentModelId);
  const availableCommands = useAgentStore((s) => s.availableCommands);
  const isResponding = useAgentStore((s) => s.isResponding);
  const isCreatingSession = useAgentStore((s) => s.isCreatingSession);
  const setInputText = useAgentStore((s) => s.setInputText);
  const setCurrentModeId = useAgentStore((s) => s.setCurrentModeId);
  const setCurrentModelId = useAgentStore((s) => s.setCurrentModelId);
  const sendPrompt = useAgentStore((s) => s.sendPrompt);
  const cancelPrompt = useAgentStore((s) => s.cancelPrompt);

  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);

  const disabled = connectionStatus !== "connected" || isCreatingSession;

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

  const modeItems: ComboboxItem[] = useMemo(
    () =>
      availableModes.map((mode) => ({
        id: mode.id,
        name: mode.name,
        description: mode.description,
      })),
    [availableModes],
  );

  const modelItems: ComboboxItem[] = useMemo(
    () =>
      availableModels.map((model) => ({
        id: model.modelId,
        name: model.name,
        description: model.description,
      })),
    [availableModels],
  );

  return (
    <div className="shrink-0 pr-3 pb-4">
      <div className="relative">
        {showSlashMenu && (
          <div className="absolute bottom-[calc(100%+0.5rem)] left-0 right-0 rounded-md border glass-surface glass-border-subtle shadow-lg max-h-48 overflow-y-auto z-20 p-1">
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
            className="field-sizing-content min-h-15 w-full resize-none rounded-md bg-transparent p-4 text-sm transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50"
            value={inputText}
            disabled={disabled}
            placeholder={
              disabled ? "starting session..." : "ask ai anything..."
            }
            maxRows={MAX_ROWS}
            onChange={(event) => setInputText(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <InputGroupAddon align="block-end">
            <SelectorCombobox
              items={modeItems}
              selectedId={currentModeId}
              onSelect={setCurrentModeId}
              label="mode"
              disabled={disabled}
            />

            {availableModels.length > 0 && (
              <SelectorCombobox
                items={modelItems}
                selectedId={currentModelId}
                onSelect={setCurrentModelId}
                label="model"
                disabled={disabled}
              />
            )}

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
