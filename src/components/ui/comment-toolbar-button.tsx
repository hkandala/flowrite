import { MessageSquareTextIcon } from "lucide-react";
import { useEditorRef } from "platejs/react";

import { commentPlugin } from "@/components/editor/plugins/comment-kit";

import { Kbd } from "./kbd";
import { ToolbarButton } from "./toolbar";

export function CommentToolbarButton() {
  const editor = useEditorRef();

  return (
    <ToolbarButton
      onClick={() => {
        editor.getTransforms(commentPlugin).comment.setDraft();
      }}
      data-plate-prevent-overlay
      tooltip={
        <>
          comment <Kbd>⌘D</Kbd>
        </>
      }
    >
      <MessageSquareTextIcon />
    </ToolbarButton>
  );
}
