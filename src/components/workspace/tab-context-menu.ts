import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";

export interface TabMenuActions {
  onClose: (panelId: string) => void;
  onCloseOthers: (panelId: string) => void;
  onCloseAll: () => void;
  onCloseSaved: () => void;
}

export async function showTabContextMenu(
  panelId: string,
  actions: TabMenuActions,
): Promise<void> {
  const [closeItem, closeOthersItem, closeAllItem, sep, closeSavedItem] =
    await Promise.all([
      MenuItem.new({ text: "Close", action: () => actions.onClose(panelId) }),
      MenuItem.new({
        text: "Close Others",
        action: () => actions.onCloseOthers(panelId),
      }),
      MenuItem.new({ text: "Close All", action: () => actions.onCloseAll() }),
      PredefinedMenuItem.new({ item: "Separator" }),
      MenuItem.new({
        text: "Close Saved",
        action: () => actions.onCloseSaved(),
      }),
    ]);

  const menu = await Menu.new({
    items: [closeItem, closeOthersItem, closeAllItem, sep, closeSavedItem],
  });
  await menu.popup();
}
