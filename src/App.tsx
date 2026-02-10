import { useEffect } from "react";
import { Router, Route, Switch, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";

import { listen } from "@tauri-apps/api/event";
import { exit } from "@tauri-apps/api/process";

import { ThemeProvider } from "@/components/ui/theme-provider";
import Workspace from "@/components/workspace/workspace";

import {
  useAppStore,
  THEME_UPDATED_EVENT,
  type Theme,
} from "@/store/app-store";

export function App() {
  const initTheme = useAppStore((state) => state.initTheme);
  const setTheme = useAppStore((state) => state.setTheme);

  // load theme from tauri store on mount
  useEffect(() => {
    initTheme();
  }, [initTheme]);

  // listen for theme changes from other windows
  useEffect(() => {
    const unlisten = listen<Theme>(THEME_UPDATED_EVENT, (event) => {
      // update theme without broadcasting to avoid infinite loop
      setTheme(event.payload, false);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setTheme]);

  // cmd+q to quit directly
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey) return;
      if (event.key.toLowerCase() !== "q") return;
      if (event.repeat) return;

      event.preventDefault();
      exit(0);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <ThemeProvider>
      <Router hook={useHashLocation}>
        <Switch>
          <Route path="/workspace" component={Workspace} />
          <Route>
            <Redirect to="/workspace" />
          </Route>
        </Switch>
      </Router>
    </ThemeProvider>
  );
}

export default App;
