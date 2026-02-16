import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { homeDir } from "@tauri-apps/api/path";
import { openUrl, openPath } from "@tauri-apps/plugin-opener";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Check if a file path points to a Claude plan document (~/.claude/plans/*.md). */
export function isClaudePlanFile(filePath: string | null): boolean {
  if (!filePath) return false;
  return /\/.claude\/plans\/[^/]+$/.test(filePath);
}

let cachedBaseDir: string | null = null;

export async function getBaseDir(): Promise<string> {
  if (!cachedBaseDir) {
    const home = await homeDir();
    // homeDir() may include a trailing slash — normalize
    const normalized = home.endsWith("/") ? home.slice(0, -1) : home;
    cachedBaseDir = `${normalized}/flowrite`;
  }
  return cachedBaseDir;
}

export async function isInternalPath(absolutePath: string): Promise<boolean> {
  const baseDir = await getBaseDir();
  return absolutePath.startsWith(baseDir);
}

/** Open a file from its absolute path, routing to internal or external as needed. */
export async function openFileFromAbsolutePath(
  absolutePath: string,
  openFile: (path: string) => void,
  openExternalFile: (path: string) => void,
) {
  const internal = await isInternalPath(absolutePath);

  if (internal) {
    const baseDir = await getBaseDir();
    let relativePath = absolutePath;
    if (absolutePath.startsWith(baseDir)) {
      relativePath = absolutePath.slice(baseDir.length);
      if (relativePath.startsWith("/")) {
        relativePath = relativePath.slice(1);
      }
    }
    openFile(relativePath);
  } else {
    openExternalFile(absolutePath);
  }
}

function isWebUrl(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("file:");
}

/**
 * Resolves a relative path against a file path (like GitHub link resolution).
 * Both basePath and result are relative paths (no leading slash).
 */
function resolveRelativePath(basePath: string, relativePath: string): string {
  const lastSlash = basePath.lastIndexOf("/");
  const baseDir = lastSlash >= 0 ? basePath.substring(0, lastSlash) : "";
  const combined = baseDir ? `${baseDir}/${relativePath}` : relativePath;

  const parts = combined.split("/");
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }

  return resolved.join("/");
}

/**
 * Resolves a relative path against an absolute file path.
 * Returns an absolute path (with leading slash).
 */
function resolveAbsoluteFilePath(
  basePath: string,
  relativePath: string,
): string {
  const lastSlash = basePath.lastIndexOf("/");
  const baseDir = lastSlash >= 0 ? basePath.substring(0, lastSlash) : "";
  const combined = `${baseDir}/${relativePath}`;

  const parts = combined.split("/");
  const resolved: string[] = [""];

  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (resolved.length > 1) resolved.pop();
    } else {
      resolved.push(part);
    }
  }

  return resolved.join("/");
}

/**
 * Handles link navigation from the editor.
 * - Web URLs → open in browser
 * - .md file links → open in editor tab
 * - Other file links → open with system default app
 * - Relative links resolve like GitHub (relative to current file's directory)
 */
export async function handleLinkNavigation(
  href: string,
  activeFilePath: string | null,
  openFile: (path: string) => void,
  openExternalFile: (path: string) => void,
): Promise<void> {
  if (isWebUrl(href)) {
    await openUrl(href);
    return;
  }

  // Strip fragment and query from file paths, decode percent-encoding
  const cleanHref = decodeURIComponent(href.split("#")[0].split("?")[0]);
  if (!cleanHref) return;

  const isMd = cleanHref.toLowerCase().endsWith(".md");

  // Absolute file path
  if (cleanHref.startsWith("/")) {
    if (isMd) {
      await openFileFromAbsolutePath(cleanHref, openFile, openExternalFile);
    } else {
      await openPath(cleanHref);
    }
    return;
  }

  // Relative path — resolve against current file
  if (!activeFilePath) {
    await openUrl(href);
    return;
  }

  const isCurrentExternal = activeFilePath.startsWith("/");

  if (isCurrentExternal) {
    const resolved = resolveAbsoluteFilePath(activeFilePath, cleanHref);
    if (isMd) {
      await openFileFromAbsolutePath(resolved, openFile, openExternalFile);
    } else {
      await openPath(resolved);
    }
  } else {
    const resolved = resolveRelativePath(activeFilePath, cleanHref);
    if (isMd) {
      openFile(resolved);
    } else {
      const baseDir = await getBaseDir();
      await openPath(`${baseDir}/${resolved}`);
    }
  }
}
