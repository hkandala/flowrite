import { useEffect } from "react";

import { useAppStore, type Theme } from "@/store/app-store";

type ThemeProviderProps = {
  children: React.ReactNode;
};

export function ThemeProvider({ children }: ThemeProviderProps) {
  const theme = useAppStore((state) => state.theme);

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove("light", "dark");
    root.classList.add(theme);
  }, [theme]);

  return <>{children}</>;
}

export const useTheme = (): {
  theme: Theme;
  setTheme: (theme: Theme) => void;
} => {
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);

  return { theme, setTheme };
};
