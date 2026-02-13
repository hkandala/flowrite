import type { TComment } from "@/components/ui/comment";

import { customAlphabet } from "nanoid";
import { createPlatePlugin } from "platejs/react";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const discussionNanoid = customAlphabet(alphabet, 4);

/** Generate a short stable ID for persisting discussions across sessions. */
export function generateDiscussionId(): string {
  return discussionNanoid();
}

export type TDiscussion = {
  id: string;
  comments: TComment[];
  createdAt: Date;
  isResolved: boolean;
  userId: string;
  documentContent?: string;
};

const usersData: Record<
  string,
  { id: string; avatarUrl?: string; name: string; hue?: number }
> = {
  me: {
    id: "me",
    name: "Me",
  },
};

// This plugin is purely UI. It's only used to store the discussions and users data
export const discussionPlugin = createPlatePlugin({
  key: "discussion",
  options: {
    currentUserId: "me",
    discussions: [] as TDiscussion[],
    users: usersData,
  },
}).extendSelectors(({ getOption }) => ({
  currentUser: () => getOption("users")[getOption("currentUserId")],
  user: (id: string) => getOption("users")[id],
}));

export const DiscussionKit = [discussionPlugin];
