import * as React from "react";

import type { CreatePlateEditorOptions } from "platejs/react";

import { getCommentKey, getDraftCommentKey } from "@platejs/comment";
import { CommentPlugin, useCommentId } from "@platejs/comment/react";
import {
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  format,
} from "date-fns";
import { CheckIcon, PencilIcon, XIcon } from "lucide-react";
import { type Value, HistoryApi, KEYS, nanoid, NodeApi } from "platejs";
import {
  Plate,
  useEditorPlugin,
  useEditorRef,
  usePlateEditor,
  usePluginOption,
} from "platejs/react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { BasicMarksKit } from "@/components/editor/plugins/basic-marks-kit";
import {
  type TDiscussion,
  discussionPlugin,
  generateDiscussionId,
} from "@/components/editor/plugins/discussion-kit";
import { Editor, EditorContainer } from "./editor";

export type TComment = {
  id: string;
  contentRich: Value;
  createdAt: Date;
  discussionId: string;
  isEdited: boolean;
  userId: string;
};

export function Comment(props: {
  comment: TComment;
  editingId: string | null;
  index: number;
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>;
  documentContent?: string;
  onDiscussionChange?: () => void;
}) {
  const { comment, editingId, index, setEditingId, onDiscussionChange } = props;

  const editor = useEditorRef();
  const userInfo = usePluginOption(discussionPlugin, "user", comment.userId);
  const currentUserId = usePluginOption(discussionPlugin, "currentUserId");

  const resolveDiscussion = (id: string) => {
    const updatedDiscussions = editor
      .getOption(discussionPlugin, "discussions")
      .map((d) => (d.id === id ? { ...d, isResolved: true } : d));
    editor.setOption(discussionPlugin, "discussions", updatedDiscussions);
    onDiscussionChange?.();
  };

  const updateComment = (input: {
    id: string;
    contentRich: Value;
    discussionId: string;
  }) => {
    const updatedDiscussions = editor
      .getOption(discussionPlugin, "discussions")
      .map((d) => {
        if (d.id !== input.discussionId) return d;
        return {
          ...d,
          comments: d.comments.map((c) =>
            c.id === input.id
              ? { ...c, contentRich: input.contentRich, isEdited: true }
              : c,
          ),
        };
      });
    editor.setOption(discussionPlugin, "discussions", updatedDiscussions);
    onDiscussionChange?.();
  };

  const { tf } = useEditorPlugin(CommentPlugin);
  const isMyComment = currentUserId === comment.userId;
  const initialValue = comment.contentRich;

  const commentEditor = useCommentEditor(
    { id: comment.id, value: initialValue },
    [initialValue],
  );

  const onCancel = () => {
    setEditingId(null);
    commentEditor.tf.replaceNodes(initialValue, { at: [], children: true });
  };

  const onSave = () => {
    void updateComment({
      id: comment.id,
      contentRich: commentEditor.children,
      discussionId: comment.discussionId,
    });
    setEditingId(null);
  };

  const onEditBlur = React.useCallback(() => {
    // Use a small delay so clicks on the cancel/save buttons can fire first
    setTimeout(() => {
      const content = NodeApi.string({
        children: commentEditor.children,
        type: KEYS.p,
      });
      const originalContent = NodeApi.string({
        children: initialValue,
        type: KEYS.p,
      });
      if (!content.trim() || content === originalContent) {
        onCancel();
      }
    }, 150);
  }, [commentEditor, initialValue, onCancel]);

  const onResolveComment = () => {
    void resolveDiscussion(comment.discussionId);
    HistoryApi.withoutSaving(editor, () => {
      tf.comment.unsetMark({ id: comment.discussionId });
    });
  };

  const isEditing = editingId === comment.id;
  const [hovering, setHovering] = React.useState(false);

  // Focus comment editor when entering edit mode
  React.useEffect(() => {
    if (isEditing) {
      setTimeout(() => {
        commentEditor.tf.focus({ edge: "endEditor" });
      }, 0);
    }
  }, [isEditing]);

  // Handle Escape to cancel editing
  React.useEffect(() => {
    if (!isEditing) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isEditing]);

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="relative flex items-center gap-1.5">
        <span className="font-medium text-foreground/60">
          {userInfo?.name?.toLowerCase()}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-xs text-muted-foreground/40 cursor-default">
              {formatCommentDate(new Date(comment.createdAt))}
              {comment.isEdited ? " (edited)" : ""}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {format(new Date(comment.createdAt), "MMM d, yyyy h:mm a")}
          </TooltipContent>
        </Tooltip>

        {isMyComment && hovering && !isEditing && (
          <div className="absolute right-0 flex space-x-0.5">
            {index === 0 && (
              <Button
                variant="ghost"
                className="h-5 w-5 p-0 text-muted-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onResolveComment();
                }}
                type="button"
              >
                <CheckIcon className="size-3" />
              </Button>
            )}
            <Button
              variant="ghost"
              className="h-5 w-5 p-0 text-muted-foreground"
              onClick={(e) => {
                e.stopPropagation();
                setEditingId(comment.id);
              }}
              type="button"
            >
              <PencilIcon className="size-3" />
            </Button>
          </div>
        )}
      </div>

      <div className="mt-1">
        <Plate readOnly={!isEditing} editor={commentEditor}>
          <EditorContainer
            variant="comment"
            className="border-0 px-0 py-0 has-[[data-slate-editor]:focus]:ring-0"
          >
            <Editor
              variant="comment"
              className="w-auto min-w-0 grow leading-relaxed"
              onBlur={isEditing ? onEditBlur : undefined}
              onKeyDown={(e) => {
                if (isEditing && e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSave();
                }
              }}
            />
          </EditorContainer>
        </Plate>

        {isEditing && (
          <div className="flex justify-end gap-1 mt-1">
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.stopPropagation();
                onCancel();
              }}
            >
              <XIcon className="size-3 text-muted-foreground" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.stopPropagation();
                onSave();
              }}
            >
              <CheckIcon className="size-3 text-foreground" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

const useCommentEditor = (
  options: Omit<CreatePlateEditorOptions, "plugins"> = {},
  deps: any[] = [],
) => {
  return usePlateEditor(
    { id: "comment", plugins: BasicMarksKit, value: [], ...options },
    deps,
  );
};

export function CommentCreateForm({
  autoFocus = false,
  className,
  discussionId: discussionIdProp,
  focusOnMount = false,
  placeholder: placeholderProp,
  onSubmitted,
  onCancel,
  onDiscussionChange,
}: {
  autoFocus?: boolean;
  className?: string;
  discussionId?: string;
  focusOnMount?: boolean;
  placeholder?: string;
  onSubmitted?: (discussionId?: string) => void;
  onCancel?: () => void;
  onDiscussionChange?: () => void;
}) {
  const discussions = usePluginOption(discussionPlugin, "discussions");
  const editor = useEditorRef();
  const commentId = useCommentId();
  const discussionId = discussionIdProp ?? commentId;

  const [commentValue, setCommentValue] = React.useState<Value | undefined>();
  const commentContent = React.useMemo(
    () =>
      commentValue
        ? NodeApi.string({ children: commentValue, type: KEYS.p })
        : "",
    [commentValue],
  );
  const editorId = React.useId();
  const commentEditor = useCommentEditor({ id: editorId });

  const [isActive, setIsActive] = React.useState(!!onCancel);

  const handleCancel = React.useCallback(() => {
    if (onCancel) {
      onCancel();
    } else {
      commentEditor.tf.reset();
      setCommentValue(undefined);
      setIsActive(false);
    }
  }, [onCancel, commentEditor.tf]);

  const handleBlur = React.useCallback(() => {
    // Use a small delay so clicks on the cancel/submit buttons can fire first
    setTimeout(() => {
      const content = NodeApi.string({
        children: commentEditor.children,
        type: KEYS.p,
      });
      if (!content.trim()) {
        handleCancel();
      }
    }, 150);
  }, [commentEditor, handleCancel]);

  React.useEffect(() => {
    if (commentEditor && focusOnMount) {
      commentEditor.tf.focus();
    }
  }, [commentEditor, focusOnMount]);

  // Handle Escape to cancel
  React.useEffect(() => {
    if (!isActive && !onCancel) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isActive, onCancel, handleCancel]);

  const onAddComment = React.useCallback(async () => {
    if (!commentValue) return;

    const content = NodeApi.string({
      children: commentValue,
      type: KEYS.p,
    });
    if (!content.trim()) return;

    commentEditor.tf.reset();
    setIsActive(false);

    if (discussionId) {
      const discussion = discussions.find((d) => d.id === discussionId);
      if (!discussion) {
        // New discussion from a known ID (e.g. draft converted)
        const newDiscussion: TDiscussion = {
          id: discussionId,
          comments: [
            {
              id: nanoid(),
              contentRich: commentValue,
              createdAt: new Date(),
              discussionId,
              isEdited: false,
              userId: editor.getOption(discussionPlugin, "currentUserId"),
            },
          ],
          createdAt: new Date(),
          isResolved: false,
          userId: editor.getOption(discussionPlugin, "currentUserId"),
        };
        editor.setOption(discussionPlugin, "discussions", [
          ...discussions,
          newDiscussion,
        ]);
        onDiscussionChange?.();
        onSubmitted?.();
        return;
      }

      // Reply to existing discussion
      const comment: TComment = {
        id: nanoid(),
        contentRich: commentValue,
        createdAt: new Date(),
        discussionId,
        isEdited: false,
        userId: editor.getOption(discussionPlugin, "currentUserId"),
      };

      const updatedDiscussions = discussions.map((d) =>
        d.id === discussionId
          ? { ...d, comments: [...d.comments, comment] }
          : d,
      );
      editor.setOption(discussionPlugin, "discussions", updatedDiscussions);
      onDiscussionChange?.();
      onSubmitted?.();
      return;
    }

    // Draft comment — convert draft marks to real comment marks
    const commentsNodeEntry = editor
      .getApi(CommentPlugin)
      .comment.nodes({ at: [], isDraft: true });

    if (commentsNodeEntry.length === 0) return;

    const documentContent = commentsNodeEntry
      .map(([node]) => node.text)
      .join("");

    const _discussionId = generateDiscussionId();
    const newDiscussion: TDiscussion = {
      id: _discussionId,
      comments: [
        {
          id: nanoid(),
          contentRich: commentValue,
          createdAt: new Date(),
          discussionId: _discussionId,
          isEdited: false,
          userId: editor.getOption(discussionPlugin, "currentUserId"),
        },
      ],
      createdAt: new Date(),
      documentContent,
      isResolved: false,
      userId: editor.getOption(discussionPlugin, "currentUserId"),
    };

    editor.setOption(discussionPlugin, "discussions", [
      ...discussions,
      newDiscussion,
    ]);
    onDiscussionChange?.();

    const id = newDiscussion.id;
    HistoryApi.withoutSaving(editor, () => {
      commentsNodeEntry.forEach(([, path]) => {
        editor.tf.setNodes(
          { [getCommentKey(id)]: true },
          { at: path, split: true },
        );
        editor.tf.unsetNodes([getDraftCommentKey()], { at: path });
      });
    });

    onSubmitted?.(id);
  }, [
    commentValue,
    commentEditor.tf,
    discussionId,
    editor,
    discussions,
    onSubmitted,
  ]);

  const currentUserId = usePluginOption(discussionPlugin, "currentUserId");
  const currentUserInfo = usePluginOption(
    discussionPlugin,
    "user",
    currentUserId,
  );

  const isReply = discussionId
    ? discussions.some((d) => d.id === discussionId)
    : false;
  const resolvedPlaceholder =
    placeholderProp ?? (isReply ? "reply..." : "add a comment...");
  const hasContent = commentContent.trim().length > 0;
  const showControls = isActive || !!onCancel;

  return (
    <div className={cn("w-full", className)}>
      {showControls && isReply && (
        <div className="flex items-center gap-1.5 mt-0.5 mb-1">
          <span className="font-medium text-foreground/60">
            {currentUserInfo?.name?.toLowerCase()}
          </span>
        </div>
      )}

      <Plate
        onChange={({ value }) => setCommentValue(value)}
        editor={commentEditor}
      >
        <EditorContainer
          variant="comment"
          className="border-0 px-0 py-0 has-[[data-slate-editor]:focus]:ring-0"
        >
          <Editor
            variant="comment"
            className="min-h-6 min-w-0 grow leading-relaxed"
            onFocus={() => setIsActive(true)}
            onBlur={handleBlur}
            onKeyDown={(e) => {
              if (!isActive) setIsActive(true);
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onAddComment();
              }
            }}
            placeholder={resolvedPlaceholder}
            autoComplete="off"
            autoFocus={autoFocus}
          />
        </EditorContainer>
      </Plate>

      {showControls && (
        <div className="flex justify-end gap-1 mt-1">
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            onClick={(e) => {
              e.stopPropagation();
              handleCancel();
            }}
          >
            <XIcon className="size-3 text-muted-foreground" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            disabled={!hasContent}
            onClick={(e) => {
              e.stopPropagation();
              onAddComment();
            }}
          >
            <CheckIcon className="size-3 text-foreground" />
          </Button>
        </div>
      )}
    </div>
  );
}

export const formatCommentDate = (date: Date) => {
  const now = new Date();
  const diffMinutes = differenceInMinutes(now, date);
  const diffHours = differenceInHours(now, date);
  const diffDays = differenceInDays(now, date);

  if (diffMinutes < 60) return `${diffMinutes}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 2) return `${diffDays}d`;
  return format(date, "MM/dd/yyyy");
};
