import { useEffect, useState, useRef } from "react";

import type { PlateElementProps } from "platejs/react";

import { PlateElement, usePluginOption } from "platejs/react";

import { TodoViewPlugin } from "@/components/editor/plugins/todo-view-plugin";
import { cn } from "@/lib/utils";

export function ParagraphElement(props: PlateElementProps) {
  const hideChecked = usePluginOption(TodoViewPlugin, "hideChecked");
  const element = props.element as {
    listStyleType?: string;
    checked?: boolean;
  };
  const isTodo = element.listStyleType === "todo";
  const isChecked = element.checked === true;
  const shouldHide = isTodo && hideChecked && isChecked;

  // track previous checked state to detect when user checks the item
  const prevChecked = useRef(isChecked);

  // delayed hide for collapse animation
  const [isHidden, setIsHidden] = useState(shouldHide);
  const [isCollapsing, setIsCollapsing] = useState(false);

  useEffect(() => {
    if (shouldHide && !isHidden) {
      // only animate if the checked state just changed from unchecked to checked
      // (i.e., user just checked this item, not when hideChecked setting changed)
      const userJustChecked = !prevChecked.current && isChecked && hideChecked;

      if (userJustChecked) {
        // user just checked this item - animate collapse
        setIsCollapsing(true);
        const timer = setTimeout(() => {
          setIsHidden(true);
          setIsCollapsing(false);
        }, 200); // match transition duration
        prevChecked.current = isChecked;
        return () => clearTimeout(timer);
      } else {
        // hideChecked setting changed or initial load - hide immediately
        setIsHidden(true);
        prevChecked.current = isChecked;
      }
    } else if (!shouldHide && isHidden) {
      // immediately show
      setIsHidden(false);
      setIsCollapsing(false);
      prevChecked.current = isChecked;
    } else {
      // keep prevChecked in sync even when shouldHide/isHidden don't change
      prevChecked.current = isChecked;
    }
  }, [shouldHide, isHidden, isChecked, hideChecked]);

  return (
    <PlateElement
      {...props}
      className={cn(
        "m-0 px-0 py-1",
        isCollapsing &&
          "h-0 overflow-hidden py-0 opacity-50 transition-all duration-200",
        isHidden && "hidden",
      )}
    >
      {props.children}
    </PlateElement>
  );
}
