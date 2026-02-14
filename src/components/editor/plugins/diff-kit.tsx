import { createSlatePlugin } from "platejs";
import { toPlatePlugin } from "platejs/react";

import { DiffLeaf } from "@/components/ui/diff-leaf";

const BaseDiffPlugin = createSlatePlugin({
  key: "diff",
  node: {
    isLeaf: true,
  },
});

export const DiffPlugin = toPlatePlugin(BaseDiffPlugin, {
  node: {
    component: DiffLeaf,
  },
});
