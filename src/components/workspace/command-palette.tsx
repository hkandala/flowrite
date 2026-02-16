import { useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { FileText, FolderOpen } from "lucide-react";
import { toast } from "sonner";

import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { useWorkspaceStore, focusActiveEditor } from "@/store/workspace-store";
import { openFileFromAbsolutePath } from "@/lib/utils";

interface FSEntry {
  path: string;
  is_dir: boolean;
}

function getFileName(path: string): string {
  return path.split("/").pop() || path;
}

export function CommandPalette() {
  const open = useWorkspaceStore((s) => s.commandPaletteOpen);
  const setOpen = useWorkspaceStore((s) => s.setCommandPaletteOpen);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const openExternalFile = useWorkspaceStore((s) => s.openExternalFile);

  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<FSEntry[]>([]);

  // fetch workspace files when palette opens
  useEffect(() => {
    if (!open) return;
    setQuery("");
    invoke<FSEntry[]>("list_dir", { path: "", recursive: true })
      .then((entries) => {
        setFiles(
          entries.filter(
            (e) => !e.is_dir && getFileName(e.path).endsWith(".md"),
          ),
        );
      })
      .catch(() => {
        setFiles([]);
      });
  }, [open]);

  const isExternalPath = query.startsWith("/") || query.startsWith("~");

  // filtered workspace files
  const filtered = useMemo(() => {
    if (isExternalPath) return [];
    const q = query.toLowerCase();
    return files
      .filter((f) => {
        const name = getFileName(f.path);
        const display = name.endsWith(".md") ? name.slice(0, -3) : name;
        return (
          display.toLowerCase().includes(q) ||
          name.toLowerCase().includes(q) ||
          f.path.toLowerCase().includes(q)
        );
      })
      .slice(0, 10);
  }, [files, query, isExternalPath]);

  const handleSelectFile = (filePath: string) => {
    openFile(filePath);
    setOpen(false);
    focusActiveEditor();
  };

  const handleSelectExternalPath = async () => {
    let resolvedPath = query;
    if (resolvedPath.startsWith("~")) {
      try {
        const home = await homeDir();
        const normalized = home.endsWith("/") ? home.slice(0, -1) : home;
        resolvedPath = normalized + resolvedPath.slice(1);
      } catch {
        toast.error("failed to resolve home directory");
        return;
      }
    }

    try {
      await invoke("read_external_file", { path: resolvedPath });
      setOpen(false);
      await openFileFromAbsolutePath(resolvedPath, openFile, openExternalFile);
      focusActiveEditor();
    } catch {
      toast.error("file not found");
    }
  };

  const displayName = (entry: FSEntry) => {
    const name = getFileName(entry.path);
    return name.endsWith(".md") ? name.slice(0, -3) : name;
  };

  const displayPath = (entry: FSEntry) => {
    const dir = entry.path.includes("/")
      ? entry.path.slice(0, entry.path.lastIndexOf("/"))
      : null;
    return dir;
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Open File"
      description="Search for a file to open"
      showCloseButton={false}
    >
      <CommandInput
        placeholder="search files..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {isExternalPath ? (
          <CommandGroup>
            <CommandItem onSelect={handleSelectExternalPath}>
              <FolderOpen className="h-4 w-4" />
              <span className="truncate">open {query}</span>
            </CommandItem>
          </CommandGroup>
        ) : (
          <>
            <CommandEmpty>no files found</CommandEmpty>
            <CommandGroup>
              {filtered.map((entry) => (
                <CommandItem
                  key={entry.path}
                  value={entry.path}
                  onSelect={() => handleSelectFile(entry.path)}
                >
                  <FileText className="h-4 w-4 shrink-0" />
                  <span className="truncate">{displayName(entry)}</span>
                  {displayPath(entry) && (
                    <span className="ml-auto text-xs text-muted-foreground truncate">
                      {displayPath(entry)}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
