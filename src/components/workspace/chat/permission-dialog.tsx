import { Button } from "@/components/ui/button";
import type { PermissionRequest } from "@/store/agent-store";

interface PermissionDialogProps {
  permission: PermissionRequest;
  isResponding: boolean;
  onRespond: (requestId: string, optionId: string) => void;
}

/** Strip wrapping literal quotes: `"foo"` -> `foo` */
const cleanTitle = (raw: string): string =>
  raw.replace(/^"(.*)"$/, "$1").trim();

export function PermissionDialog({
  permission,
  isResponding,
  onRespond,
}: PermissionDialogProps) {
  const description = permission.title
    ? cleanTitle(permission.title)
    : null;

  // Sort options: reject first, then allow_always, then allow
  const sortedOptions = [...permission.options].sort((a, b) => {
    const order = (kind: string) => {
      if (kind.startsWith("reject")) return 0;
      if (kind === "allow_always") return 1;
      if (kind.startsWith("allow")) return 2;
      return 3;
    };
    return order(a.kind) - order(b.kind);
  });

  const getButtonProps = (kind: string) => {
    if (kind.startsWith("reject")) {
      return {
        variant: "ghost" as const,
        className: "text-destructive",
        label: "Block",
      };
    }
    if (kind === "allow_always") {
      return {
        variant: "ghost" as const,
        className: "",
        label: "Always Allow",
      };
    }
    if (kind.startsWith("allow")) {
      return {
        variant: "outline" as const,
        className: "",
        label: "Allow",
      };
    }
    return {
      variant: "outline" as const,
      className: "",
      label: null, // use option.name as fallback
    };
  };

  return (
    <div className="glass-surface glass-border-subtle rounded-lg p-3 space-y-3">
      <div className="space-y-1">
        <p className="text-sm text-foreground">
          Agent needs permission to continue
        </p>
        {description && (
          <p className="text-xs text-muted-foreground truncate">
            {description}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {sortedOptions.map((option) => {
          const props = getButtonProps(option.kind);
          return (
            <Button
              key={option.optionId}
              type="button"
              variant={props.variant}
              size="sm"
              className={props.className}
              disabled={!isResponding}
              onClick={() => onRespond(permission.requestId, option.optionId)}
            >
              {props.label ?? option.name}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
