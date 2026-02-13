import { Button } from "@/components/ui/button";
import { deriveLabel } from "@/lib/tool-call-label";
import type { PermissionRequest, ToolCall } from "@/store/agent-store";

interface PermissionDialogProps {
  permission: PermissionRequest;
  matchedToolCall?: ToolCall;
  isResponding: boolean;
  onRespond: (requestId: string, optionId: string) => void;
}

export function PermissionDialog({
  permission,
  matchedToolCall,
  isResponding,
  onRespond,
}: PermissionDialogProps) {
  const isSwitchMode = matchedToolCall?.kind === "switch_mode";

  const description = matchedToolCall
    ? (() => {
        if (isSwitchMode) return null;
        const { verb, subject } = deriveLabel(matchedToolCall, "infinitive");
        return subject ? `${verb} ${subject}` : verb;
      })()
    : null;

  const title = isSwitchMode
    ? (matchedToolCall?.title?.replace(/^"(.*)"$/, "$1").toLowerCase() ??
      "ready to code?")
    : "agent needs permission to continue";

  // Sort options: for switch_mode reverse (allow first, reject last),
  // otherwise reject first, then allow_always, then allow
  const sortedOptions = [...permission.options].sort((a, b) => {
    const order = (kind: string) => {
      if (isSwitchMode) {
        if (kind.startsWith("allow") && kind !== "allow_always") return 0;
        if (kind === "allow_always") return 1;
        if (kind.startsWith("reject")) return 2;
        return 3;
      }
      if (kind.startsWith("reject")) return 0;
      if (kind === "allow_always") return 1;
      if (kind.startsWith("allow")) return 2;
      return 3;
    };
    return order(a.kind) - order(b.kind);
  });

  const getButtonProps = (option: { kind: string; name: string }) => {
    // For switch_mode (plan approval), use the agent's own labels
    if (isSwitchMode) {
      if (option.kind.startsWith("reject")) {
        return {
          variant: "ghost" as const,
          className: "text-destructive",
          label: option.name.toLowerCase(),
        };
      }
      return {
        variant: "outline" as const,
        className: "",
        label: option.name.toLowerCase(),
      };
    }

    if (option.kind.startsWith("reject")) {
      return {
        variant: "ghost" as const,
        className: "text-destructive",
        label: "block",
      };
    }
    if (option.kind === "allow_always") {
      return {
        variant: "ghost" as const,
        className: "",
        label: "always allow",
      };
    }
    if (option.kind.startsWith("allow")) {
      return {
        variant: "outline" as const,
        className: "",
        label: "allow",
      };
    }
    return {
      variant: "outline" as const,
      className: "",
      label: option.name,
    };
  };

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
      <div className="space-y-1.5">
        <p className="text-sm text-foreground">{title}</p>
        {description && (
          <p
            className="text-xs text-muted-foreground truncate"
            title={description}
          >
            {description}
          </p>
        )}
      </div>
      <div
        className={
          isSwitchMode
            ? "flex flex-col items-start gap-2"
            : "flex flex-wrap gap-2"
        }
      >
        {sortedOptions.map((option) => {
          const props = getButtonProps(option);
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
              {props.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
