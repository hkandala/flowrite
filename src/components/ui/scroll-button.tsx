import type { VariantProps } from "class-variance-authority";
import { ChevronDown } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ScrollButtonProps = {
  className?: string;
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
  isAtBottom: boolean;
  onScrollToBottom: () => void;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick">;

function ScrollButton({
  className,
  variant = "outline",
  size = "sm",
  isAtBottom,
  onScrollToBottom,
  ...props
}: ScrollButtonProps) {
  return (
    <Button
      variant={variant}
      size={size}
      className={cn(
        "h-8 w-8 rounded-full transition-all duration-150 ease-out",
        !isAtBottom
          ? "translate-y-0 scale-100 opacity-100"
          : "pointer-events-none translate-y-4 scale-95 opacity-0",
        className,
      )}
      onClick={onScrollToBottom}
      {...props}
    >
      <ChevronDown className="h-4 w-4" />
    </Button>
  );
}

export { ScrollButton };
