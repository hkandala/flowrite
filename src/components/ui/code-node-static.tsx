import type { SlateLeafProps } from "platejs";

import { SlateLeaf } from "platejs";

export function CodeLeafStatic(props: SlateLeafProps) {
  const isEmpty = !props.leaf.text || /^\u200B*$/.test(props.leaf.text);

  return (
    <SlateLeaf
      {...props}
      as="code"
      className={
        isEmpty
          ? ""
          : "inline-block max-w-full wrap-break-word rounded-md border bg-muted-foreground/10 dark:bg-muted px-[0.3em] py-[0.2em] font-mono align-baseline"
      }
    >
      {props.children}
    </SlateLeaf>
  );
}
