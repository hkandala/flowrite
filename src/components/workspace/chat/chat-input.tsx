import { ArrowUp, Check, ChevronDown, Square } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Plate, createPlateEditor } from "platejs/react";
import { ParagraphPlugin, PlateContent } from "platejs/react";
import { NodeApi } from "platejs";

import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/store/agent-store";
import { useWorkspaceStore } from "@/store/workspace-store";
import { getOpenFiles } from "@/store/workspace-store";
import { FileReferenceKit } from "@/components/chat/plugins/file-reference-kit";
import {
  serializeChatValue,
  serializeOpenFiles,
} from "@/components/chat/transforms/serialize-chat-value";

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
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          className="h-8 px-2.5 gap-1.5 text-sm shadow-none"
        >
          <span className="truncate max-w-48">{selected?.name ?? label}</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
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
  const activeTab = useAgentStore((s) =>
    s.chatTabs.find((t) => t.id === s.activeChatTabId),
  );
  const session = useAgentStore((s) => {
    const tab = s.chatTabs.find((t) => t.id === s.activeChatTabId);
    return tab?.sessionId ? s.sessions[tab.sessionId] : null;
  });
  const sendPromptAction = useAgentStore((s) => s.sendPrompt);
  const cancelPromptAction = useAgentStore((s) => s.cancelPrompt);
  const setModeAction = useAgentStore((s) => s.setMode);
  const setModelAction = useAgentStore((s) => s.setModel);
  const setChatEditor = useWorkspaceStore((s) => s.setChatEditor);

  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);

  const chatEditor = useMemo(
    () =>
      createPlateEditor({
        plugins: [ParagraphPlugin, ...FileReferenceKit],
      }),
    [],
  );

  useEffect(() => {
    setChatEditor(chatEditor);
    return () => setChatEditor(null);
  }, [chatEditor, setChatEditor]);

  const submitDisabled = !session || (activeTab?.isConnecting ?? false);
  const isResponding = session?.isResponding ?? false;
  const availableModes = session?.availableModes ?? [];
  const currentModeId = session?.currentModeId ?? null;
  const availableModels = session?.availableModels ?? [];
  const currentModelId = session?.currentModelId ?? null;
  const availableCommands = session?.availableCommands ?? [];

  const [editorText, setEditorText] = useState("");

  const slashQuery = useMemo(() => {
    if (!editorText.startsWith("/")) return null;
    if (editorText.includes("\n")) return null;
    const firstLine = editorText.split("\n")[0];
    if (firstLine.includes(" ")) return null;
    return firstLine.slice(1).toLowerCase();
  }, [editorText]);

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

  const applySlashCommand = useCallback(
    (commandName: string) => {
      chatEditor.tf.reset();
      chatEditor.tf.insertText(`/${commandName} `);
    },
    [chatEditor],
  );

  const submitPrompt = useCallback(() => {
    if (submitDisabled || isResponding || !session) return;
    const chatText = serializeChatValue(chatEditor.children).trim();
    if (!chatText) return;

    const openFilesXml = serializeOpenFiles(getOpenFiles());
    const text = openFilesXml ? `${openFilesXml}\n\n${chatText}` : chatText;

    const editorValue = JSON.parse(JSON.stringify(chatEditor.children));
    void sendPromptAction(session.sessionId, text, editorValue);
    chatEditor.tf.reset();
    setEditorText("");
  }, [submitDisabled, isResponding, session, chatEditor, sendPromptAction]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
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
          if (selected) applySlashCommand(selected.name);
          return;
        }
        event.preventDefault();
        submitPrompt();
        return;
      }
      if (event.key === "Escape" && showSlashMenu) {
        event.preventDefault();
        chatEditor.tf.insertText(" ");
      }
    },
    [
      showSlashMenu,
      filteredCommands,
      selectedCommandIndex,
      applySlashCommand,
      submitPrompt,
      chatEditor,
    ],
  );

  const handleEditorChange = useCallback(({ value }: { value: any[] }) => {
    const firstBlockText =
      value.length > 0 ? NodeApi.string(value[0] as any) : "";
    setEditorText(firstBlockText);
  }, []);

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

        <div className="flex flex-col justify-between rounded-xl border border-input shadow-xs min-h-30">
          <Plate editor={chatEditor} onChange={handleEditorChange}>
            <PlateContent
              className="w-full bg-transparent p-4 text-sm outline-none"
              placeholder="ask ai or use / commands..."
              onKeyDown={handleKeyDown}
            />
          </Plate>

          <div className="flex items-center gap-1 px-3 pb-3">
            {availableModes.length > 0 && (
              <SelectorCombobox
                items={modeItems}
                selectedId={currentModeId}
                onSelect={(id) => {
                  if (session) setModeAction(session.sessionId, id);
                }}
                label="mode"
                disabled={submitDisabled}
              />
            )}

            {availableModels.length > 0 && (
              <SelectorCombobox
                items={modelItems}
                selectedId={currentModelId}
                onSelect={(id) => {
                  if (session) setModelAction(session.sessionId, id);
                }}
                label="model"
                disabled={submitDisabled}
              />
            )}

            <Button
              type="button"
              size="icon"
              variant="default"
              className="ml-auto size-8"
              disabled={submitDisabled}
              onClick={() => {
                if (isResponding && session) {
                  void cancelPromptAction(session.sessionId);
                } else {
                  submitPrompt();
                }
              }}
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
    </div>
  );
}
