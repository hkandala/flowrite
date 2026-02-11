import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { homeDir } from "@tauri-apps/api/path";

export interface FileTreeMenuActions {
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onOpen: (filePath: string) => void;
  onOpenToSide: (filePath: string) => void;
  onRename: (itemPath: string) => void;
  onDelete: (itemPath: string, isDir: boolean) => void;
  onExpandCollapse: (itemPath: string, isExpanded: boolean) => void;
}

let cachedHomeDir: string | null = null;

async function getAbsolutePath(relativePath: string): Promise<string> {
  if (!cachedHomeDir) {
    cachedHomeDir = await homeDir();
  }
  return `${cachedHomeDir}flowrite/${relativePath}`;
}

function getItemName(path: string): string {
  return path.split("/").pop() || path;
}

export async function showEmptySpaceMenu(
  actions: FileTreeMenuActions,
): Promise<void> {
  const [newFileItem, newFolderItem] = await Promise.all([
    MenuItem.new({ text: "New File", action: () => actions.onNewFile("") }),
    MenuItem.new({ text: "New Folder", action: () => actions.onNewFolder("") }),
  ]);

  const menu = await Menu.new({ items: [newFileItem, newFolderItem] });
  await menu.popup();
}

export async function showFileContextMenu(
  filePath: string,
  actions: FileTreeMenuActions,
): Promise<void> {
  const fileName = getItemName(filePath);

  const [
    openItem,
    openToSideItem,
    sep1,
    renameItem,
    deleteItem,
    sep2,
    copyNameItem,
    copyPathItem,
    copyRelativeItem,
  ] = await Promise.all([
    MenuItem.new({ text: "Open", action: () => actions.onOpen(filePath) }),
    MenuItem.new({
      text: "Open to the Side",
      action: () => actions.onOpenToSide(filePath),
    }),
    PredefinedMenuItem.new({ item: "Separator" }),
    MenuItem.new({ text: "Rename", action: () => actions.onRename(filePath) }),
    MenuItem.new({
      text: "Delete",
      action: () => actions.onDelete(filePath, false),
    }),
    PredefinedMenuItem.new({ item: "Separator" }),
    MenuItem.new({
      text: "Copy File Name",
      action: () => navigator.clipboard.writeText(fileName),
    }),
    MenuItem.new({
      text: "Copy Path",
      action: async () => {
        const absPath = await getAbsolutePath(filePath);
        navigator.clipboard.writeText(absPath);
      },
    }),
    MenuItem.new({
      text: "Copy Relative Path",
      action: () => navigator.clipboard.writeText(filePath),
    }),
  ]);

  const menu = await Menu.new({
    items: [
      openItem,
      openToSideItem,
      sep1,
      renameItem,
      deleteItem,
      sep2,
      copyNameItem,
      copyPathItem,
      copyRelativeItem,
    ],
  });
  await menu.popup();
}

export async function showFolderContextMenu(
  folderPath: string,
  isExpanded: boolean,
  actions: FileTreeMenuActions,
): Promise<void> {
  const folderName = getItemName(folderPath);

  const [
    expandCollapseItem,
    sep1,
    newFileItem,
    newFolderItem,
    sep2,
    renameItem,
    deleteItem,
    sep3,
    copyNameItem,
    copyPathItem,
    copyRelativeItem,
  ] = await Promise.all([
    MenuItem.new({
      text: isExpanded ? "Collapse" : "Expand",
      action: () => actions.onExpandCollapse(folderPath, isExpanded),
    }),
    PredefinedMenuItem.new({ item: "Separator" }),
    MenuItem.new({
      text: "New File",
      action: () => actions.onNewFile(folderPath),
    }),
    MenuItem.new({
      text: "New Folder",
      action: () => actions.onNewFolder(folderPath),
    }),
    PredefinedMenuItem.new({ item: "Separator" }),
    MenuItem.new({
      text: "Rename",
      action: () => actions.onRename(folderPath),
    }),
    MenuItem.new({
      text: "Delete",
      action: () => actions.onDelete(folderPath, true),
    }),
    PredefinedMenuItem.new({ item: "Separator" }),
    MenuItem.new({
      text: "Copy Folder Name",
      action: () => navigator.clipboard.writeText(folderName),
    }),
    MenuItem.new({
      text: "Copy Path",
      action: async () => {
        const absPath = await getAbsolutePath(folderPath);
        navigator.clipboard.writeText(absPath);
      },
    }),
    MenuItem.new({
      text: "Copy Relative Path",
      action: () => navigator.clipboard.writeText(folderPath),
    }),
  ]);

  const menu = await Menu.new({
    items: [
      expandCollapseItem,
      sep1,
      newFileItem,
      newFolderItem,
      sep2,
      renameItem,
      deleteItem,
      sep3,
      copyNameItem,
      copyPathItem,
      copyRelativeItem,
    ],
  });
  await menu.popup();
}
