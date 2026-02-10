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
          : "inline-block max-w-full wrap-break-word rounded-md border bg-muted-foreground/10 dark:bg-muted px-[0.3em] py-[0.2em] font-mono align-baseline"
      }
    >
      {props.children}
    </PlateLeaf>
  );
}
