import * as React from "react";

import type { ExtendConfig, Path } from "platejs";

import {
  type BaseCommentConfig,
  BaseCommentPlugin,
  getDraftCommentKey,
} from "@platejs/comment";
import { HistoryApi, isSlateString } from "platejs";
import { toTPlatePlugin, useEditorSelection } from "platejs/react";

import { CommentLeaf } from "@/components/ui/comment-node";
import { useWorkspaceStore } from "@/store/workspace-store";

type CommentConfig = ExtendConfig<
  BaseCommentConfig,
  {
    activeId: string | null;
    commentingBlock: Path | null;
    hoverId: string | null;
    uniquePathMap: Map<string, Path>;
  }
>;

export const commentPlugin = toTPlatePlugin<CommentConfig>(BaseCommentPlugin, {
  handlers: {
    onClick: ({ api, event, setOption, type }) => {
      let leaf = event.target as HTMLElement;
      let isSet = false;

      const unsetActiveSuggestion = () => {
        setOption("activeId", null);
        isSet = true;
      };

      if (!isSlateString(leaf)) unsetActiveSuggestion();

      while (leaf.parentElement) {
        if (leaf.classList.contains(`slate-${type}`)) {
          const commentsEntry = api.comment!.node();

          if (!commentsEntry) {
            unsetActiveSuggestion();

            break;
          }

          const id = api.comment!.nodeId(commentsEntry[0]);

          setOption("activeId", id ?? null);
          if (id) {
            useWorkspaceStore.getState().openCommentInPanel(id);
          }
          isSet = true;

          break;
        }

        leaf = leaf.parentElement;
      }

      if (!isSet) unsetActiveSuggestion();
    },
  },
  options: {
    activeId: null,
    commentingBlock: null,
    hoverId: null,
    uniquePathMap: new Map(),
  },
})
  .extendTransforms(
    ({
      editor,
      setOption,
      tf: {
        comment: { setDraft },
      },
    }) => ({
      setDraft: () => {
        if (editor.api.isCollapsed()) {
          // No text selected — open doc-level comment
          useWorkspaceStore.getState().openNewDocComment();
          return;
        }

        HistoryApi.withoutSaving(editor, () => {
          setDraft();
        });

        editor.tf.collapse();
        setOption("activeId", getDraftCommentKey());
        setOption("commentingBlock", editor.selection!.focus.path.slice(0, 1));
        useWorkspaceStore.getState().openCommentInPanel(getDraftCommentKey());
      },
    }),
  )
  .configure({
    node: { component: CommentLeaf },
    shortcuts: {
      setDraft: { keys: "mod+d" },
    },
  })
  .extend({
    useHooks: ({ api, getOption, setOption }) => {
      const selection = useEditorSelection();

      React.useEffect(() => {
        if (!selection) return;
        // Don't override draft comment state
        if (getOption("activeId") === getDraftCommentKey()) return;

        const commentsEntry = api.comment.node();
        if (commentsEntry) {
          const id = api.comment.nodeId(commentsEntry[0]);
          if (id) {
            setOption("activeId", id);
            return;
          }
        }

        setOption("activeId", null);
      }, [api, getOption, selection, setOption]);
    },
  });

export const CommentKit = [commentPlugin];
