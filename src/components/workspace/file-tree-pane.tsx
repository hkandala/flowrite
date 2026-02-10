import {
  asyncDataLoaderFeature,
  dragAndDropFeature,
  expandAllFeature,
  hotkeysCoreFeature,
  renamingFeature,
  searchFeature,
  selectionFeature,
  type ItemInstance,
  type TreeState,
} from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  File,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWorkspaceStore } from "@/store/workspace-store";

import "./file-tree-pane.css";

// -----------------------------------------
// types
// -----------------------------------------

interface FSEntry {
  path: string;
  is_dir: boolean;
  size_bytes: number;
  created_time_ms: number;
  modified_time_ms: number;
}

interface FileTreeItem {
  id: string;
  name: string;
  isDir: boolean;
}

// -----------------------------------------
// tauri helpers
// -----------------------------------------

async function listDirectory(path: string): Promise<FSEntry[]> {
  return invoke<FSEntry[]>("list_dir", { path, recursive: false });
}

async function listDirectoryRecursive(path: string): Promise<FSEntry[]> {
  return invoke<FSEntry[]>("list_dir", { path, recursive: true });
}

// -----------------------------------------
// helpers
// -----------------------------------------

function getFileName(path: string): string {
  return path.split("/").pop() || "flowrite";
}

function getDisplayName(name: string, isDir: boolean): string {
  if (!isDir && name.endsWith(".md")) {
    return name.slice(0, -3);
  }
  return name;
}

function sortEntries(a: FSEntry, b: FSEntry): number {
  if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
  return getFileName(a.path)
    .toLowerCase()
    .localeCompare(getFileName(b.path).toLowerCase());
}

// -----------------------------------------
// constants
// -----------------------------------------

const ROOT_ID = "root";
const INDENT = 16;

// -----------------------------------------
// tree item component
// -----------------------------------------

interface TreeItemProps {
  item: ItemInstance<FileTreeItem>;
  isDimmed: boolean;
  isHighlighted: boolean;
  activeFilePath: string | null;
  onFileClick?: () => void;
  onRenameComplete?: () => void;
  onRenameCancel?: () => void;
}

function FileTreeItemRow({
  item,
  isDimmed,
  isHighlighted,
  activeFilePath,
  onFileClick,
  onRenameComplete,
  onRenameCancel,
}: TreeItemProps) {
  const level = item.getItemMeta().level - 1;
  const isFolder = item.isFolder();
  const isExpanded = item.isExpanded();
  const isActive = item.getId() === activeFilePath;
  const isFocused = item.isFocused();
  const isRenaming = item.isRenaming();
  const isLoading = item.isLoading();
  const displayName = item.getItemName();
  const Icon = isFolder ? (isExpanded ? FolderOpen : Folder) : File;

  const itemProps = item.getProps();

  return (
    <div
      {...itemProps}
      onClick={(e) => {
        itemProps.onClick?.(e);
        if (!isFolder && !isLoading && onFileClick) {
          onFileClick();
        }
      }}
      className={cn(
        "file-tree-item",
        isActive && "selected",
        isFocused && "focused",
        isDimmed && "dimmed",
        isHighlighted && "highlighted",
        item.isDragTarget?.() && "drag-target",
        item.isDragTargetAbove?.() && "drag-above",
        item.isDragTargetBelow?.() && "drag-below",
        isLoading && !item.hasLoadedData?.() && "file-tree-loading-item",
      )}
      style={{ paddingLeft: `${level * INDENT + 8}px` }}
    >
      {/* guide lines */}
      {Array.from({ length: level }, (_, i) => (
        <div
          key={i}
          className="file-tree-guide"
          style={{ left: `${i * INDENT + 8 + INDENT / 2}px` }}
        />
      ))}

      {/* expand/collapse chevron */}
      <span className={cn("file-tree-chevron", !isFolder && "invisible")}>
        <ChevronRight
          className={cn(
            "h-3 w-3 transition-transform duration-150",
            isExpanded && "rotate-90",
          )}
        />
      </span>

      {/* file/folder icon */}
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          isFolder ? "text-muted-foreground" : "text-muted-foreground/70",
        )}
      />

      {/* name or rename input */}
      {isRenaming ? (
        <input
          {...item.getRenameInputProps()}
          className="file-tree-rename-input"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              onRenameComplete?.();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onRenameCancel?.();
            }
          }}
        />
      ) : (
        <span className="file-tree-name">{displayName}</span>
      )}

      {/* loading spinner */}
      {isLoading && (
        <Loader2 className="h-3 w-3 shrink-0 text-muted-foreground/50 animate-spin ml-auto" />
      )}
    </div>
  );
}

// -----------------------------------------
// file tree pane
// -----------------------------------------

export function FileTreePane() {
  const openFile = useWorkspaceStore((s) => s.openFile);
  const activeFilePath = useWorkspaceStore((s) => s.activeFilePath);
  const requestEditorTabFocus = useWorkspaceStore(
    (s) => s.requestEditorTabFocus,
  );

  // cache: directory path -> children ids
  const childrenCacheRef = useRef<Map<string, string[]>>(new Map());
  // cache: item id -> FileTreeItem
  const itemCacheRef = useRef<Map<string, FileTreeItem>>(new Map());

  // local ref for programmatic focus
  const treeContainerRef = useRef<HTMLDivElement | null>(null);

  // filter state
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterValue, setFilterValue] = useState("");
  const [state, setState] = useState<Partial<TreeState<FileTreeItem>>>({
    expandedItems: [ROOT_ID],
  });
  const filterInputRef = useRef<HTMLInputElement>(null);
  const filterToggleButtonRef = useRef<HTMLButtonElement>(null);

  // snapshot of expanded items before filter was opened (to restore on close)
  const expandedBeforeFilterRef = useRef<string[]>([ROOT_ID]);

  // loading state
  const [isExpandingAll, setIsExpandingAll] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // recursive data for expand all & filtering
  const [allRecursiveItems, setAllRecursiveItems] = useState<FSEntry[]>([]);
  const [isLoadingRecursive, setIsLoadingRecursive] = useState(false);

  // initialize root item in cache
  useEffect(() => {
    itemCacheRef.current.set(ROOT_ID, {
      id: ROOT_ID,
      name: "flowrite",
      isDir: true,
    });
  }, []);

  // fetch children for a directory and populate caches
  const fetchChildren = useCallback(
    async (itemId: string): Promise<string[]> => {
      const cached = childrenCacheRef.current.get(itemId);
      if (cached) return cached;

      const dirPath = itemId === ROOT_ID ? "" : itemId;

      try {
        const entries = await listDirectory(dirPath);
        entries.sort(sortEntries);

        const childIds = entries.map((e) => e.path);

        for (const entry of entries) {
          itemCacheRef.current.set(entry.path, {
            id: entry.path,
            name: getFileName(entry.path),
            isDir: entry.is_dir,
          });
        }

        childrenCacheRef.current.set(itemId, childIds);
        return childIds;
      } catch {
        return [];
      }
    },
    [],
  );

  // fetch item data
  const fetchItem = useCallback(
    async (itemId: string): Promise<FileTreeItem> => {
      const cached = itemCacheRef.current.get(itemId);
      if (cached) return cached;

      const item: FileTreeItem = {
        id: itemId,
        name: getFileName(itemId),
        isDir: false,
      };
      itemCacheRef.current.set(itemId, item);
      return item;
    },
    [],
  );

  const tree = useTree<FileTreeItem>({
    rootItemId: ROOT_ID,
    getItemName: (item) => {
      const data = item.getItemData();
      if (!data?.name) return "...";
      return getDisplayName(data.name, data.isDir);
    },
    isItemFolder: (item) => item.getItemData()?.isDir ?? false,
    createLoadingItemData: () => ({
      id: "__loading__",
      name: "...",
      isDir: false,
    }),
    dataLoader: {
      getItem: (itemId) => fetchItem(itemId),
      getChildren: (itemId) => fetchChildren(itemId),
    },
    indent: INDENT,
    features: [
      asyncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      renamingFeature,
      searchFeature,
      expandAllFeature,
      dragAndDropFeature,
    ],
    state,
    setState,
    isSearchMatchingItem: (search, item) => {
      if (!search) return false;
      return item.getItemName().toLowerCase().includes(search.toLowerCase());
    },
    hotkeys: {
      // we handle Enter ourselves for rename (can't use renameItem: Enter
      // because it conflicts with completeRenaming which also uses Enter)
      renameItem: { hotkey: "F2", isEnabled: () => false },
      // disable search hotkeys — we manage filter/search ourselves
      openSearch: { hotkey: "LetterOrNumber", isEnabled: () => false },
      closeSearch: { hotkey: "Escape", isEnabled: () => false },
      submitSearch: { hotkey: "Enter", isEnabled: () => false },
    },
    onPrimaryAction: (item) => {
      if (!item.isFolder() && !item.isLoading()) {
        openFile(item.getId());
      }
    },
    onRename: async (item, newName) => {
      const itemId = item.getId();
      const oldData = itemCacheRef.current.get(itemId);
      if (!oldData) return;

      const finalName =
        !oldData.isDir && !newName.endsWith(".md") ? `${newName}.md` : newName;

      const parentPath = itemId.includes("/")
        ? itemId.substring(0, itemId.lastIndexOf("/"))
        : "";
      const newPath = parentPath ? `${parentPath}/${finalName}` : finalName;

      try {
        if (oldData.isDir) {
          await invoke("rename_dir", { oldPath: itemId, newPath });
        } else {
          await invoke("rename_file", { oldPath: itemId, newPath: finalName });
        }

        itemCacheRef.current.delete(itemId);
        itemCacheRef.current.set(newPath, {
          id: newPath,
          name: finalName,
          isDir: oldData.isDir,
        });

        const parentId = parentPath || ROOT_ID;
        childrenCacheRef.current.delete(parentId);
        try {
          tree.getItemInstance(parentId).invalidateChildrenIds();
        } catch {
          /* parent may not be loaded */
        }
      } catch (e) {
        console.error("Rename failed:", e);
        itemCacheRef.current.set(itemId, oldData);
      }
    },
    canDrag: (items) => items.every((i) => i.getId() !== ROOT_ID),
    canReorder: false,
    canDrop: (items, target) => {
      const targetItem = target.item;
      if (!targetItem) return false;
      if (!targetItem.isFolder()) return false;
      for (const item of items) {
        if (targetItem.getId() === item.getId()) return false;
        if (targetItem.isDescendentOf(item.getId())) return false;
      }
      return true;
    },
    onDrop: async (items, target) => {
      const targetFolderId = target.item.isFolder()
        ? target.item.getId()
        : target.item.getParent()?.getId() || ROOT_ID;

      const targetPath = targetFolderId === ROOT_ID ? "" : targetFolderId;
      const parentsToInvalidate = new Set<string>([targetFolderId]);

      for (const item of items) {
        const oldPath = item.getId();
        const name = oldPath.split("/").pop()!;
        const newPath = targetPath ? `${targetPath}/${name}` : name;
        if (oldPath === newPath) continue;

        const sourceParent = item.getParent();
        if (sourceParent) parentsToInvalidate.add(sourceParent.getId());

        const isDir = item.isFolder();
        try {
          if (isDir) {
            await invoke("rename_dir", { oldPath, newPath });
          } else {
            await invoke("rename_file", { oldPath, newPath: name });
          }
        } catch (e) {
          console.error("Move failed:", e);
        }
      }

      for (const parentId of parentsToInvalidate) {
        childrenCacheRef.current.delete(parentId);
        try {
          tree.getItemInstance(parentId).invalidateChildrenIds();
        } catch {
          /* item may no longer exist */
        }
      }
    },
  });

  // ---- items & filter matching ----

  const items = tree.getItems();

  const { matchingIds, ancestorIds } = useMemo(() => {
    if (!filterValue)
      return {
        matchingIds: new Set<string>(),
        ancestorIds: new Set<string>(),
      };

    const lowerFilter = filterValue.toLowerCase();
    const matching = new Set<string>();
    const ancestors = new Set<string>();

    for (const [id, cachedItem] of itemCacheRef.current) {
      const displayName = getDisplayName(cachedItem.name, cachedItem.isDir);
      if (displayName.toLowerCase().includes(lowerFilter)) {
        matching.add(id);
        const parts = id.split("/");
        for (let i = 1; i < parts.length; i++) {
          ancestors.add(parts.slice(0, i).join("/"));
        }
        ancestors.add(ROOT_ID);
      }
    }

    return { matchingIds: matching, ancestorIds: ancestors };
  }, [items, filterValue]);

  // auto-expand ancestor folders when filter matches change
  useEffect(() => {
    if (filterValue && ancestorIds.size > 0) {
      setState((prev) => ({
        ...prev,
        expandedItems: [
          ...new Set([
            ...(prev.expandedItems ?? []),
            ...Array.from(ancestorIds),
          ]),
        ],
      }));
    }
  }, [filterValue, ancestorIds]);

  // when the active editor file changes, expand its parent folders
  useEffect(() => {
    if (!activeFilePath) return;

    const parentPaths: string[] = [ROOT_ID];
    const parts = activeFilePath.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parentPath = parts.slice(0, i).join("/");
      parentPaths.push(parentPath);
      if (!itemCacheRef.current.has(parentPath)) {
        itemCacheRef.current.set(parentPath, {
          id: parentPath,
          name: getFileName(parentPath),
          isDir: true,
        });
      }
    }

    setState((prev) => {
      const current = prev.expandedItems ?? [];
      const merged = [...new Set([...current, ...parentPaths])];
      return { ...prev, expandedItems: merged, focusedItem: activeFilePath };
    });
  }, [activeFilePath]);

  // visible items = everything minus the root node
  const visibleItems = useMemo(
    () => items.filter((item) => item.getId() !== ROOT_ID),
    [items],
  );

  // track whether focus entered the tree via keyboard (Tab) vs mouse
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  const lastInputWasKeyboardRef = useRef(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") lastInputWasKeyboardRef.current = true;
    };
    const onMouseDown = () => {
      lastInputWasKeyboardRef.current = false;
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onMouseDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onMouseDown, true);
    };
  }, []);

  // ensure there's always a focused item when the tree receives focus
  const ensureTreeHasFocusedItem = useCallback(() => {
    setState((prev) => {
      if (prev.focusedItem) return prev;
      const fallbackId = activeFilePath || visibleItems[0]?.getId();
      return fallbackId ? { ...prev, focusedItem: fallbackId } : prev;
    });
  }, [activeFilePath, visibleItems]);

  // set a default focused item once the tree loads so arrow keys work
  // immediately when the user tabs to the tree (without showing focus ring on load)
  const initialFocusDoneRef = useRef(false);
  useEffect(() => {
    if (initialFocusDoneRef.current || visibleItems.length === 0) return;
    initialFocusDoneRef.current = true;
    ensureTreeHasFocusedItem();
  }, [visibleItems.length, ensureTreeHasFocusedItem]);

  // ---- fetch all recursive items for expand all & filtering ----

  const fetchAllRecursive = useCallback(async () => {
    if (allRecursiveItems.length > 0 || isLoadingRecursive) return;
    setIsLoadingRecursive(true);
    try {
      const entries = await listDirectoryRecursive("");
      setAllRecursiveItems(entries);

      for (const entry of entries) {
        itemCacheRef.current.set(entry.path, {
          id: entry.path,
          name: getFileName(entry.path),
          isDir: entry.is_dir,
        });
      }

      const childrenMap = new Map<string, string[]>();
      for (const entry of entries) {
        const parentPath =
          entry.path.lastIndexOf("/") >= 0
            ? entry.path.substring(0, entry.path.lastIndexOf("/"))
            : "";
        const parentId = parentPath === "" ? ROOT_ID : parentPath;

        if (!childrenMap.has(parentId)) {
          childrenMap.set(parentId, []);
        }
        childrenMap.get(parentId)!.push(entry.path);
      }

      for (const [, children] of childrenMap) {
        children.sort((a, b) => {
          const aItem = itemCacheRef.current.get(a);
          const bItem = itemCacheRef.current.get(b);
          const aDir = aItem?.isDir ?? false;
          const bDir = bItem?.isDir ?? false;
          if (aDir !== bDir) return aDir ? -1 : 1;
          return getFileName(a).localeCompare(getFileName(b));
        });
      }

      for (const [parentId, children] of childrenMap) {
        childrenCacheRef.current.set(parentId, children);
      }
    } catch (err) {
      console.error("failed to fetch recursive tree:", err);
    } finally {
      setIsLoadingRecursive(false);
    }
  }, [allRecursiveItems.length, isLoadingRecursive]);

  // ---- handlers ----

  const handleToggleFilter = useCallback(async () => {
    if (filterOpen) {
      setFilterOpen(false);
      setFilterValue("");
      tree.closeSearch();
      setState((prev) => ({
        ...prev,
        expandedItems: expandedBeforeFilterRef.current,
      }));
      requestAnimationFrame(() => filterToggleButtonRef.current?.focus());
    } else {
      expandedBeforeFilterRef.current = [...(state.expandedItems ?? [ROOT_ID])];
      setFilterOpen(true);
      tree.openSearch("");
      await fetchAllRecursive();
      requestAnimationFrame(() => filterInputRef.current?.focus());
    }
  }, [filterOpen, tree, fetchAllRecursive, state.expandedItems]);

  const handleFilterChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setFilterValue(v);
      tree.setSearch(v || null);
    },
    [tree],
  );

  const handleExpandAll = useCallback(async () => {
    setIsExpandingAll(true);
    try {
      await fetchAllRecursive();
      const allFolderIds: string[] = [ROOT_ID];
      for (const [id, item] of itemCacheRef.current) {
        if (item.isDir) {
          allFolderIds.push(id);
        }
      }
      setState((prev) => ({
        ...prev,
        expandedItems: allFolderIds,
      }));
    } catch (e) {
      console.error("expand all failed:", e);
    } finally {
      setIsExpandingAll(false);
    }
  }, [fetchAllRecursive]);

  const handleCollapseAll = useCallback(() => {
    tree.collapseAll();
  }, [tree]);

  const handleRefresh = useCallback(() => {
    childrenCacheRef.current.clear();
    const rootItem = itemCacheRef.current.get(ROOT_ID);
    itemCacheRef.current.clear();
    if (rootItem) {
      itemCacheRef.current.set(ROOT_ID, rootItem);
    }
    setAllRecursiveItems([]);
    setIsRefreshing(true);

    try {
      const rootInstance = tree.getItemInstance(ROOT_ID);
      rootInstance.invalidateChildrenIds();
    } catch {
      /* root may not exist yet */
    }

    setState((prev) => ({
      ...prev,
      expandedItems: [ROOT_ID],
    }));

    setTimeout(() => setIsRefreshing(false), 600);
  }, [tree]);

  const handleKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLDivElement>,
      htOnKeyDown?: React.KeyboardEventHandler<HTMLDivElement>,
    ) => {
      // let Tab pass through for natural tab navigation
      if (e.key === "Tab") return;

      // Enter: start rename OR complete rename
      if (e.key === "Enter" && !e.defaultPrevented) {
        if (state.renamingItem) {
          // currently renaming — let headless-tree's completeRenaming handle it
          htOnKeyDown?.(e);
        } else {
          // start renaming the focused item
          e.preventDefault();
          const focusedId = state.focusedItem;
          if (focusedId) {
            try {
              tree.getItemInstance(focusedId).startRenaming();
            } catch {
              /* item may not be loaded */
            }
          }
        }
        return;
      }

      // let headless-tree handle its hotkeys (arrows, Esc for abort rename, etc.)
      htOnKeyDown?.(e);

      // Space: toggle folder expand or open file
      if (e.code === "Space" && !e.defaultPrevented) {
        e.preventDefault();
        const focusedId = state.focusedItem;
        if (!focusedId) return;

        try {
          const item = tree.getItemInstance(focusedId);
          if (item.isFolder()) {
            item.isExpanded() ? item.collapse() : item.expand();
          } else {
            item.primaryAction();
          }
        } catch {
          /* item may not be loaded */
        }
        return;
      }

      // letter/number: open filter and start typing
      if (
        /^[a-z0-9]$/i.test(e.key) &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !state.renamingItem
      ) {
        e.preventDefault();
        if (!filterOpen) {
          expandedBeforeFilterRef.current = [
            ...(state.expandedItems ?? [ROOT_ID]),
          ];
          setFilterOpen(true);
          tree.openSearch(e.key);
          fetchAllRecursive();
        }
        setFilterValue(e.key);
        tree.setSearch(e.key);
        requestAnimationFrame(() => filterInputRef.current?.focus());
      }
    },
    [
      state.focusedItem,
      state.renamingItem,
      state.expandedItems,
      tree,
      filterOpen,
      fetchAllRecursive,
    ],
  );

  // ---- render ----

  const isAnyLoading = isExpandingAll || isRefreshing || isLoadingRecursive;
  const containerProps = tree.getContainerProps();

  return (
    <div className="file-tree-pane">
      {/* toolbar */}
      <div className="file-tree-header">
        <span className="file-tree-title">flowrite</span>
        <div className="file-tree-actions">
          <button
            type="button"
            className="file-tree-btn"
            onClick={handleExpandAll}
            disabled={isExpandingAll}
            aria-label="Expand all folders"
            title="expand all"
          >
            {isExpandingAll ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ChevronsUpDown className="h-3 w-3" />
            )}
          </button>
          <button
            type="button"
            className="file-tree-btn"
            onClick={handleCollapseAll}
            aria-label="Collapse all folders"
            title="collapse all"
          >
            <ChevronsDownUp className="h-3 w-3" />
          </button>
          <button
            ref={filterToggleButtonRef}
            type="button"
            className={cn("file-tree-btn", filterOpen && "active")}
            onClick={handleToggleFilter}
            aria-label={filterOpen ? "Close filter" : "Open filter"}
            title="filter"
          >
            <Search className="h-3 w-3" />
          </button>
          <button
            type="button"
            className={cn("file-tree-btn", isRefreshing && "active")}
            onClick={handleRefresh}
            disabled={isAnyLoading}
            aria-label="Refresh file tree"
            title="refresh"
          >
            {isRefreshing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </button>
        </div>
      </div>

      {/* filter input */}
      {filterOpen && (
        <div className="file-tree-filter">
          <Search className="h-3 w-3 text-muted-foreground shrink-0" />
          <input
            ref={filterInputRef}
            type="text"
            placeholder="filter files..."
            value={filterValue}
            onChange={handleFilterChange}
            className="file-tree-filter-input"
            aria-label="Filter files"
            onKeyDown={(e) => {
              if (e.key === "Escape") handleToggleFilter();
            }}
          />
          {filterValue && (
            <button
              type="button"
              className="file-tree-filter-clear"
              aria-label="Clear filter"
              onClick={() => {
                setFilterValue("");
                tree.setSearch(null);
                filterInputRef.current?.focus();
              }}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {/* tree body */}
      <ScrollArea className="file-tree-scroll">
        <div
          {...containerProps}
          ref={(el: HTMLDivElement | null) => {
            tree.registerElement(el);
            treeContainerRef.current = el;
          }}
          tabIndex={-1}
          aria-label="File explorer"
          onFocus={(e) => {
            containerProps.onFocus?.(e);
            ensureTreeHasFocusedItem();
            setKeyboardFocused(lastInputWasKeyboardRef.current);
          }}
          onBlur={(e) => {
            // only clear if focus is leaving the tree entirely
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setKeyboardFocused(false);
            }
          }}
          onKeyDown={(e) => handleKeyDown(e, containerProps.onKeyDown)}
          className={cn(
            "file-tree-container",
            keyboardFocused && "keyboard-focused",
          )}
        >
          {visibleItems.length === 0 ? (
            <div className="file-tree-empty">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/40" />
            </div>
          ) : (
            visibleItems.map((item) => {
              const isFiltering = !!filterValue;
              const isMatch = matchingIds.has(item.getId());
              const isAncestor = ancestorIds.has(item.getId());
              const isDimmed = isFiltering && !isMatch && !isAncestor;

              return (
                <FileTreeItemRow
                  key={item.getId()}
                  item={item}
                  isDimmed={isDimmed}
                  isHighlighted={isFiltering && isMatch}
                  activeFilePath={activeFilePath}
                  onFileClick={requestEditorTabFocus}
                  onRenameComplete={() => tree.completeRenaming()}
                  onRenameCancel={() => tree.abortRenaming()}
                />
              );
            })
          )}

          {/* drag line indicator */}
          <div
            className="file-tree-drag-line"
            style={tree.getDragLineStyle()}
          />
        </div>
      </ScrollArea>
    </div>
  );
}
