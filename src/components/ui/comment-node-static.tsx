import type { TCommentText } from "platejs";
import type { PlateLeafProps } from "platejs/react";

import { PlateLeaf } from "platejs/react";

export function CommentLeafStatic(props: PlateLeafProps<TCommentText>) {
  return (
    <PlateLeaf
      {...props}
      className="border-b-2 border-b-highlight/35 bg-highlight/15"
    >
      {props.children}
    </PlateLeaf>
  );
}
