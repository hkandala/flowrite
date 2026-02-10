// polyfill Buffer for gray-matter (node.js dependency used in browser)
import { Buffer } from "buffer";
globalThis.Buffer = Buffer;

import "./App.css";

import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
