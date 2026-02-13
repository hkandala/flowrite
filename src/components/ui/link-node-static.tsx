import { openUrl } from "@tauri-apps/plugin-opener";

import { AnchorHTMLAttributes, MouseEvent } from "react";

import type { SlateElementProps, TLinkElement } from "platejs";

import { getLinkAttributes } from "@platejs/link";
import { SlateElement } from "platejs";

export function LinkElementStatic(props: SlateElementProps<TLinkElement>) {
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

    if (event.button !== 0 || !href) {
      return;
    }

    openUrl(href);
  };

  return (
    <SlateElement
      {...props}
      as="a"
      className="font-medium text-primary underline decoration-primary underline-offset-4 hover:cursor-pointer"
      attributes={{
        ...props.attributes,
        ...linkAttributes,
        onClick: handleClick,
      }}
    >
      {props.children}
    </SlateElement>
  );
}
