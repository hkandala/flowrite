import type { PlateLeafProps } from "platejs/react";

import { PlateLeaf } from "platejs/react";

export function CodeLeaf(props: PlateLeafProps) {
  const isEmpty = !props.leaf.text || /^\u200B*$/.test(props.leaf.text);

  return (
    <PlateLeaf
      {...props}
      as="code"
      className={
        isEmpty
          ? ""
          : "rounded-md border bg-muted-foreground/10 dark:bg-muted px-[0.3em] font-mono text-[0.9em]"
      }
    >
      {props.children}
    </PlateLeaf>
  );
}
