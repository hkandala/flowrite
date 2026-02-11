import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { homeDir } from "@tauri-apps/api/path";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
