import { useEffect } from "react";
import { Router, Route, Switch, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";

import { listen } from "@tauri-apps/api/event";

import { ThemeProvider } from "@/components/ui/theme-provider";
import { Toaster } from "@/components/ui/sonner";
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
      <Toaster />
    </ThemeProvider>
  );
}

export default App;
