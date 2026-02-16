import { AnchorHTMLAttributes, MouseEvent, useEffect, useState } from "react";
import type { TLinkElement } from "platejs";
import type { PlateElementProps } from "platejs/react";

import { getLinkAttributes } from "@platejs/link";
import { PlateElement } from "platejs/react";

import { useWorkspaceStore } from "@/store/workspace-store";
import { handleLinkNavigation } from "@/lib/utils";

export function LinkElement(props: PlateElementProps<TLinkElement>) {
  const [cursorState, setCursorState] = useState<string>("default");

  const linkAttributes = getLinkAttributes(props.editor, props.element);

  const anchorAttributes =
    linkAttributes as AnchorHTMLAttributes<HTMLAnchorElement>;
  const href =
    typeof anchorAttributes.href === "string"
      ? anchorAttributes.href
      : undefined;

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    anchorAttributes.onClick?.(event);

    event.preventDefault();
    event.stopPropagation();

    setCursorState("default");

    if (event.button !== 0 || !href || !event.metaKey) {
      return;
    }

    const { activeFilePath, openFile, openExternalFile } =
      useWorkspaceStore.getState();
    handleLinkNavigation(href, activeFilePath, openFile, openExternalFile);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey) return;
      setCursorState("pointer");
    };

    const handleKeyUp = () => {
      setCursorState("default");
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  return (
    <PlateElement
      {...props}
      as="a"
      className={`font-medium text-primary underline decoration-primary underline-offset-4 ${
        cursorState === "pointer" ? "hover:cursor-pointer" : ""
      }`}
      attributes={{
        ...props.attributes,
        ...linkAttributes,
        onClick: handleClick,
        onMouseOver: (e) => {
          e.stopPropagation();
        },
      }}
    >
      {props.children}
    </PlateElement>
  );
}
