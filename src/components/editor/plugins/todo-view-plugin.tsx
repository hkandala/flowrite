import { createPlatePlugin } from "platejs/react";

export const TodoViewPlugin = createPlatePlugin({
  key: "todoView",
  options: {
    hideChecked: false,
  },
});
