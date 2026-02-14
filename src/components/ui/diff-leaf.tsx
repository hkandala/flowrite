import { PlateLeaf } from "platejs/react";

import { cn } from "@/lib/utils";

import type { DiffOperation } from "@platejs/diff";

const componentMap = {
  delete: "del",
  insert: "ins",
  update: "span",
} as const;

export function DiffLeaf(props: any) {
  const leaf = props.leaf as { diff?: boolean; diffOperation?: DiffOperation };
  const op = leaf.diffOperation?.type ?? "update";
  const Component = componentMap[op] ?? "span";

  return (
    <PlateLeaf
      {...props}
      as={Component}
      className={cn(
        op === "insert" && "bg-emerald-100 text-emerald-700",
        op === "delete" && "bg-red-100 text-red-700 line-through",
        op === "update" && "bg-blue-100 text-blue-700",
      )}
    >
      {props.children}
    </PlateLeaf>
  );
}
