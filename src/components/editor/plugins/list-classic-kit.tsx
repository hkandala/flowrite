import {
  BulletedListPlugin,
  ListItemContentPlugin,
  ListItemPlugin,
  ListPlugin,
  NumberedListPlugin,
  TaskListPlugin,
} from "@platejs/list-classic/react";

import {
  BulletedListElement,
  ListItemElement,
  NumberedListElement,
  TaskListElement,
} from "@/components/ui/list-classic-node";

export const ListKit = [
  ListPlugin,
  ListItemPlugin,
  ListItemContentPlugin,
  BulletedListPlugin.configure({
    node: { component: BulletedListElement },
  }),
  NumberedListPlugin.configure({
    node: { component: NumberedListElement },
  }),
  TaskListPlugin.configure({
    node: { component: TaskListElement },
  }),
  ListItemPlugin.withComponent(ListItemElement),
];
