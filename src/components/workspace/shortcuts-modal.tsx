import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Shortcut {
  keys: string;
  description: string;
}

interface ShortcutGroup {
  title: string;
  shortcuts: Shortcut[];
}

const shortcutGroups: ShortcutGroup[] = [
  {
    title: "general",
    shortcuts: [
      { keys: "⌘N", description: "new file" },
      { keys: "⌘O", description: "open file" },
      { keys: "⌘S", description: "save" },
      { keys: "⌘⇧S", description: "save all" },
      { keys: "⌘W", description: "close tab" },
      { keys: "⌘P", description: "command palette" },
      { keys: "Ctrl Tab", description: "next tab" },
      { keys: "Ctrl ⇧ Tab", description: "previous tab" },
      { keys: "⌘1–9", description: "focus editor group" },
    ],
  },
  {
    title: "panels & layout",
    shortcuts: [
      { keys: "⌘⇧E", description: "toggle file tree" },
      { keys: "⌘⇧L", description: "toggle ai chat" },
      { keys: "⌘⇧=", description: "toggle zen mode" },
      { keys: "⌘⇧-", description: "toggle full width" },
    ],
  },
  {
    title: "ai & chat",
    shortcuts: [
      { keys: "⌘L", description: "ask ai / add file to chat" },
      { keys: "↩", description: "send message" },
      { keys: "⇧↩", description: "new line in chat" },
    ],
  },
  {
    title: "text formatting",
    shortcuts: [
      { keys: "⌘B", description: "bold" },
      { keys: "⌘I", description: "italic" },
      { keys: "⌘U", description: "underline" },
      { keys: "⌘⇧M", description: "strikethrough" },
      { keys: "⌘E", description: "inline code" },
      { keys: "⌘K", description: "link" },
      { keys: "⌘D", description: "comment" },
    ],
  },
  {
    title: "blocks",
    shortcuts: [
      { keys: "⌘⌥1–6", description: "heading 1–6" },
      { keys: "⌘⌥8", description: "code block" },
      { keys: "⌘⌥X", description: "toggle todo check" },
      { keys: "⌘↩", description: "insert block after" },
      { keys: "⌘⇧↩", description: "insert block before" },
    ],
  },
  {
    title: "editor navigation",
    shortcuts: [
      { keys: "⌘⌥J", description: "next block" },
      { keys: "⌘⌥K", description: "previous block" },
      { keys: "⌘⌥L", description: "next section" },
      { keys: "⌘⌥H", description: "previous section" },
    ],
  },
];

interface ShortcutsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShortcutsModal({ open, onOpenChange }: ShortcutsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle>keyboard shortcuts</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 px-6 pb-6 overflow-y-auto">
          <div className="columns-2 gap-6">
            {shortcutGroups.map((group) => (
              <div key={group.title} className="break-inside-avoid mb-5">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  {group.title}
                </h3>
                <div className="space-y-1">
                  {group.shortcuts.map((shortcut) => (
                    <div
                      key={shortcut.description}
                      className="flex items-center justify-between gap-4 py-1"
                    >
                      <span className="text-sm text-foreground/80">
                        {shortcut.description}
                      </span>
                      <kbd className="shrink-0 text-xs text-muted-foreground bg-muted/50 border border-border/50 rounded px-1.5 py-0.5 font-mono">
                        {shortcut.keys}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
