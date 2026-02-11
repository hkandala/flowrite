import { invoke } from "@tauri-apps/api/core";
import { info } from "@tauri-apps/plugin-log";
import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";

import { ThemeProvider } from "@/components/ui/theme-provider";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";

function Workspace() {
  // handle cmd+shift+n to create new workspace window
  useHotkeys("mod+shift+n", async () => {
    info("creating new workspace window via shortcut");
    try {
      await invoke("create_workspace_window");
    } catch (err) {
      console.error("failed to create workspace window:", err);
      toast.error(`failed to create workspace window: ${err}`);
    }
  });

  return (
    <ThemeProvider>
      <main className="h-screen w-screen bg-background/75 text-foreground">
        <WorkspaceLayout />
      </main>
    </ThemeProvider>
  );
}

export default Workspace;
