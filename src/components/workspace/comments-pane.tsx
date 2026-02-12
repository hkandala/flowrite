import * as React from "react";

import { getDraftCommentKey } from "@platejs/comment";
import { CommentPlugin } from "@platejs/comment/react";
import { MessageSquarePlus, MessageSquareText, Plus } from "lucide-react";
import { HistoryApi, nanoid } from "platejs";
import { Plate, useEditorRef, usePluginOption } from "platejs/react";

import {
  useWorkspaceStore,
  persistActiveEditorMetadata,
} from "@/store/workspace-store";
import {
  type TDiscussion,
  discussionPlugin,
} from "@/components/editor/plugins/discussion-kit";
import { commentPlugin } from "@/components/editor/plugins/comment-kit";
import { Badge } from "@/components/ui/badge";
import { Comment, CommentCreateForm } from "@/components/ui/comment";
import { ScrollArea } from "@/components/ui/scroll-area";

export function CommentsPane() {
  const activeEditor = useWorkspaceStore((s) => s.activeEditor);

  if (!activeEditor) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-5 text-muted-foreground p-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-foreground/8">
          <MessageSquareText className="h-5 w-5" />
        </div>
        <span className="text-sm">no active document</span>
      </div>
    );
  }

  return (
    <Plate editor={activeEditor}>
      <CommentsList />
    </Plate>
  );
}

function CommentsList() {
  const editor = useEditorRef();
  const discussions = usePluginOption(discussionPlugin, "discussions");
  const activeCommentId = useWorkspaceStore((s) => s.activeCommentId);
  const setActiveCommentId = useWorkspaceStore((s) => s.setActiveCommentId);

  const isDraft = activeCommentId === getDraftCommentKey();

  const activeDiscussions = React.useMemo(() => {
    const unresolved = discussions.filter((d: TDiscussion) => !d.isResolved);

    // Build a map of discussionId → first block index by scanning the document
    const positionMap = new Map<string, number>();
    for (let blockIdx = 0; blockIdx < editor.children.length; blockIdx++) {
      const walk = (node: any) => {
        if (typeof node.text === "string") {
          for (const key of Object.keys(node)) {
            if (key.startsWith("comment_") && key !== "comment_draft") {
              const id = key.slice("comment_".length);
              if (!positionMap.has(id)) {
                positionMap.set(id, blockIdx);
              }
            }
          }
          return;
        }
        if (node.children) {
          for (const child of node.children) walk(child);
        }
      };
      walk(editor.children[blockIdx]);
    }

    return [...unresolved].sort((a, b) => {
      // Doc-level comments have no text anchor (no documentContent)
      const isDocLevelA = !a.documentContent;
      const isDocLevelB = !b.documentContent;

      // Doc-level comments always come first
      if (isDocLevelA && isDocLevelB) {
        return (
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      }
      if (isDocLevelA) return -1;
      if (isDocLevelB) return 1;

      // Sort by block position in the document
      const blockA = positionMap.get(a.id) ?? Infinity;
      const blockB = positionMap.get(b.id) ?? Infinity;

      if (blockA !== blockB) return blockA - blockB;

      // Same block — sort by creation date
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }, [discussions, editor]);

  const activeRef = React.useRef<HTMLDivElement>(null);
  const [showDocComment, setShowDocComment] = React.useState(false);
  const docCommentId = React.useMemo(() => nanoid(), [showDocComment]);

  // Close doc-level form when a draft becomes active
  React.useEffect(() => {
    if (isDraft) setShowDocComment(false);
  }, [isDraft]);

  // Open doc-level form when triggered by hotkey
  const showNewDocCommentFlag = useWorkspaceStore((s) => s.showNewDocComment);
  React.useEffect(() => {
    if (showNewDocCommentFlag) {
      setShowDocComment(true);
      useWorkspaceStore.getState().setShowNewDocComment(false);
    }
  }, [showNewDocCommentFlag]);

  React.useEffect(() => {
    if (activeCommentId && activeRef.current) {
      activeRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [activeCommentId]);

  const handleDiscussionClick = React.useCallback(
    (discussion: TDiscussion) => {
      const node = editor.getApi(CommentPlugin).comment.node({
        id: discussion.id,
      });
      if (node) {
        // Place cursor at the start of the comment instead of selecting text
        editor.tf.select(node[1]);
        editor.tf.collapse({ edge: "start" });
        editor.tf.focus();
      }
      // Set activeId in comment plugin so the highlight brightens
      editor.setOption(commentPlugin, "activeId", discussion.id);
      setActiveCommentId(discussion.id);
    },
    [editor, setActiveCommentId],
  );

  const cancelDraft = React.useCallback(() => {
    // Remove draft marks from editor (without affecting undo history)
    HistoryApi.withoutSaving(editor, () => {
      const draftNodes = editor
        .getApi(CommentPlugin)
        .comment.nodes({ at: [], isDraft: true });
      for (const [, path] of draftNodes) {
        editor.tf.unsetNodes([getDraftCommentKey()], { at: path });
      }
    });
    editor.setOption(commentPlugin, "activeId", null);
    setActiveCommentId(null);
  }, [editor, setActiveCommentId]);

  if (activeDiscussions.length === 0 && !isDraft && !showDocComment) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-5 text-muted-foreground p-3">
        <button
          onClick={() => setShowDocComment(true)}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-foreground/8 text-muted-foreground hover:text-foreground hover:border-foreground/15 hover:bg-foreground/5 transition-colors cursor-pointer"
        >
          <MessageSquarePlus className="h-5 w-5" />
        </button>
        <span className="text-sm">add new comment</span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col pt-3 gap-3">
      {/* Header */}
      <div className="flex items-center justify-between pr-6">
        <Badge
          variant="outline"
          className="h-7 font-normal text-muted-foreground bg-transparent"
        >
          {activeDiscussions.length} comment
          {activeDiscussions.length !== 1 ? "s" : ""}
        </Badge>
        <button
          onClick={() => {
            if (isDraft) cancelDraft();
            setShowDocComment(true);
          }}
          className="flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:text-foreground hover:bg-foreground/8 transition-colors"
          title="add document comment"
        >
          <Plus className="h-4 w-4 cursor-pointer" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-4 pr-6 pb-6">
          {/* Doc-level comment form */}
          {showDocComment && (
            <div className="rounded-lg border border-border/60 bg-foreground/3 p-3.5">
              <CommentCreateForm
                focusOnMount
                discussionId={docCommentId}
                placeholder="add a comment..."
                onSubmitted={() => setShowDocComment(false)}
                onCancel={() => setShowDocComment(false)}
                onDiscussionChange={persistActiveEditorMetadata}
              />
            </div>
          )}

          {/* Draft comment form (from text selection) */}
          {isDraft && (
            <div className="rounded-lg border border-border/60 bg-foreground/3 p-3.5">
              <CommentCreateForm
                focusOnMount
                placeholder="add a comment..."
                onCancel={cancelDraft}
                onDiscussionChange={persistActiveEditorMetadata}
                onSubmitted={(id) => {
                  if (id) setActiveCommentId(id);
                }}
              />
            </div>
          )}

          {/* Discussion list */}
          {activeDiscussions.map((discussion: TDiscussion) => (
            <div
              key={discussion.id}
              ref={activeCommentId === discussion.id ? activeRef : undefined}
            >
              <DiscussionCard
                discussion={discussion}
                isActive={activeCommentId === discussion.id}
                onClick={() => handleDiscussionClick(discussion)}
              />
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function DiscussionCard({
  discussion,
  isActive,
  onClick,
}: {
  discussion: TDiscussion;
  isActive: boolean;
  onClick: () => void;
}) {
  const [editingId, setEditingId] = React.useState<string | null>(null);

  return (
    <div
      className={`rounded-lg border transition-colors cursor-pointer ${
        isActive
          ? "border-foreground/25 bg-foreground/5"
          : "bg-foreground/3 border-border/60 hover:border-foreground/15"
      }`}
      onClick={onClick}
    >
      <div className="p-4">
        {discussion.comments.map((comment, index) => (
          <React.Fragment key={comment.id ?? index}>
            {index > 0 && <div className="my-3 h-px bg-border/60" />}
            <Comment
              comment={comment}
              documentContent={discussion.documentContent}
              editingId={editingId}
              index={index}
              setEditingId={setEditingId}
              onDiscussionChange={persistActiveEditorMetadata}
            />
          </React.Fragment>
        ))}

        <div className="my-3 h-px bg-border/60" />
        <div onClick={(e) => e.stopPropagation()}>
          <CommentCreateForm
            discussionId={discussion.id}
            placeholder="reply..."
            onDiscussionChange={persistActiveEditorMetadata}
          />
        </div>
      </div>
    </div>
  );
}
