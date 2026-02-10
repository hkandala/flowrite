import { Store } from "@tauri-apps/plugin-store";
import { emit } from "@tauri-apps/api/event";

import { create } from "zustand";

import {
  THEME_STORAGE_KEY,
  SETTINGS_STORE_PATH,
  THEME_UPDATED_EVENT,
} from "@/lib/constants";

export { THEME_UPDATED_EVENT };
export type Theme = "dark" | "light";

// create a singleton store instance
let settingsStore: Store | null = null;
const getSettingsStore = async (): Promise<Store> => {
  if (!settingsStore) {
    settingsStore = await Store.load(SETTINGS_STORE_PATH);
  }
  return settingsStore;
};

interface State {
  theme: Theme;
}

interface Actions {
  initTheme: () => Promise<void>;
  setTheme: (theme: Theme, broadcast?: boolean) => void;
  toggleTheme: () => void;
}

type AppStore = State & Actions;

export const useAppStore = create<AppStore>((set, get) => ({
  // initial state
  theme: "dark", // default to dark, will be updated by initTheme

  // actions
  initTheme: async () => {
    try {
      const store = await getSettingsStore();
      const stored = await store.get<Theme>(THEME_STORAGE_KEY);
      if (stored === "light" || stored === "dark") {
        set(() => ({ theme: stored }));
      }
    } catch (e) {
      console.error("failed to load theme from store:", e);
      set(() => ({ theme: "dark" }));
    }
  },

  setTheme: (theme: Theme, broadcast = true) => {
    set(() => ({ theme }));
    // persist to store and emit global event asynchronously
    void (async () => {
      try {
        const store = await getSettingsStore();
        await store.set(THEME_STORAGE_KEY, theme);
        await store.save();
        // emit global event to sync theme across windows
        if (broadcast) {
          await emit(THEME_UPDATED_EVENT, theme);
        }
      } catch (e) {
        console.error("failed to save theme to store:", e);
      }
    })();
  },

  toggleTheme: () => {
    const currentTheme = get().theme;
    const newTheme: Theme = currentTheme === "dark" ? "light" : "dark";
    get().setTheme(newTheme);
  },
}));
