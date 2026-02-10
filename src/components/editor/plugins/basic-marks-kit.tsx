import {
  BoldPlugin,
  CodePlugin,
  HighlightPlugin,
  ItalicPlugin,
  KbdPlugin,
  StrikethroughPlugin,
  SubscriptPlugin,
  SuperscriptPlugin,
  UnderlinePlugin,
} from "@platejs/basic-nodes/react";

import { CodeLeaf } from "@/components/ui/code-node";
import { HighlightLeaf } from "@/components/ui/highlight-node";
import { KbdLeaf } from "@/components/ui/kbd-node";

export const BasicMarksKit = [
  BoldPlugin,
  ItalicPlugin,
  UnderlinePlugin,
  CodePlugin.configure({
    node: { component: CodeLeaf },
    shortcuts: { toggle: { keys: "mod+e" } },
  }),
  StrikethroughPlugin,
  SubscriptPlugin,
  SuperscriptPlugin,
  HighlightPlugin.configure({
    node: { component: HighlightLeaf },
  }),
  KbdPlugin.withComponent(KbdLeaf),
];
