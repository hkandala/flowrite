import {
  BoldIcon,
  Code2Icon,
  ItalicIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from "lucide-react";
import { KEYS } from "platejs";
import { useEditorReadOnly } from "platejs/react";

import { Kbd } from "./kbd";
import { AskAiToolbarButton } from "./ask-ai-toolbar-button";
import { LinkToolbarButton } from "./link-toolbar-button";
import { MarkToolbarButton } from "./mark-toolbar-button";
import { ToolbarGroup } from "./toolbar";
import { TurnIntoToolbarButton } from "./turn-into-toolbar-button";
import { CommentToolbarButton } from "./comment-toolbar-button";

export function FloatingToolbarButtons() {
  const readOnly = useEditorReadOnly();

  return (
    <>
      {!readOnly && (
        <>
          <ToolbarGroup>
            <TurnIntoToolbarButton />

            <MarkToolbarButton
              nodeType={KEYS.bold}
              tooltip={
                <>
                  bold <Kbd>⌘B</Kbd>
                </>
              }
            >
              <BoldIcon />
            </MarkToolbarButton>

            <MarkToolbarButton
              nodeType={KEYS.italic}
              tooltip={
                <>
                  italic <Kbd>⌘I</Kbd>
                </>
              }
            >
              <ItalicIcon />
            </MarkToolbarButton>

            <MarkToolbarButton
              nodeType={KEYS.underline}
              tooltip={
                <>
                  underline <Kbd>⌘U</Kbd>
                </>
              }
            >
              <UnderlineIcon />
            </MarkToolbarButton>

            <MarkToolbarButton
              nodeType={KEYS.strikethrough}
              tooltip={
                <>
                  strikethrough <Kbd>⌘⇧M</Kbd>
                </>
              }
            >
              <StrikethroughIcon />
            </MarkToolbarButton>

            <MarkToolbarButton
              nodeType={KEYS.code}
              tooltip={
                <>
                  code <Kbd>⌘E</Kbd>
                </>
              }
            >
              <Code2Icon />
            </MarkToolbarButton>

            <LinkToolbarButton />
          </ToolbarGroup>
          <ToolbarGroup>
            <CommentToolbarButton />
            <AskAiToolbarButton />
          </ToolbarGroup>
        </>
      )}
    </>
  );
}
