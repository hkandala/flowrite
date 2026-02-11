import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore } from "@/store/workspace-store";

export function QuitConfirmationDialog() {
  const quitConfirmation = useWorkspaceStore((s) => s.quitConfirmation);
  const resolveQuitConfirmation = useWorkspaceStore(
    (s) => s.resolveQuitConfirmation,
  );

  if (!quitConfirmation) return null;

  const { hasDirty } = quitConfirmation;

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open) {
          resolveQuitConfirmation("cancel");
        }
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>quit flowrite?</DialogTitle>
          <DialogDescription>
            {hasDirty
              ? "you have unsaved changes that will be lost."
              : "are you sure you want to quit?"}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => resolveQuitConfirmation("cancel")}
          >
            cancel
          </Button>
          {hasDirty ? (
            <>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => resolveQuitConfirmation("discard")}
              >
                don&apos;t save
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => resolveQuitConfirmation("save")}
              >
                save & quit
              </Button>
            </>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={() => resolveQuitConfirmation("discard")}
            >
              quit
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
