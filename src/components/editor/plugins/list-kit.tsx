import { ListPlugin } from "@platejs/list/react";
import { KEYS } from "platejs";

import { IndentKit } from "@/components/editor/plugins/indent-kit";
import { TodoViewPlugin } from "@/components/editor/plugins/todo-view-plugin";
import { moveToAdjacentBlock } from "@/components/editor/plugins/basic-blocks-kit";
import { BlockList } from "@/components/ui/block-list";

export const ListKit = [
  ...IndentKit,
  TodoViewPlugin,
  ListPlugin.configure({
    inject: {
      targetPlugins: [
        ...KEYS.heading,
        KEYS.p,
        KEYS.blockquote,
        KEYS.codeBlock,
        KEYS.toggle,
      ],
    },
    render: {
      belowNodes: BlockList,
    },
    shortcuts: {
      toggleTodoCheck: {
        keys: "mod+alt+x",
        handler: (ctx) => {
          const { editor } = ctx;
          const block = editor.api.block();
          if (!block || block[0].listStyleType !== "todo") return;

          const wasChecked = block[0].checked;
          editor.tf.setNodes({ checked: !wasChecked });

          // if marking as checked and hideChecked is enabled, move to next/prev block
          if (!wasChecked) {
            const hideChecked = editor.getOptions(TodoViewPlugin).hideChecked;
            if (hideChecked) {
              moveToAdjacentBlock(editor);
            }
          }
        },
      },
    },
  }),
];
