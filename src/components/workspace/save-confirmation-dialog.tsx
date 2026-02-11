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

export function SaveConfirmationDialog() {
  const saveConfirmation = useWorkspaceStore((s) => s.saveConfirmation);
  const resolveSaveConfirmation = useWorkspaceStore(
    (s) => s.resolveSaveConfirmation,
  );

  if (!saveConfirmation) return null;

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open) {
          resolveSaveConfirmation("cancel");
        }
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>save changes?</DialogTitle>
          <DialogDescription>
            do you want to save the changes you made to{" "}
            <span className="font-medium text-foreground">
              {saveConfirmation.title}
            </span>
            ? your changes will be lost if you don&apos;t save them.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => resolveSaveConfirmation("cancel")}
          >
            cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => resolveSaveConfirmation("discard")}
          >
            don&apos;t save
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => resolveSaveConfirmation("save")}
          >
            save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
