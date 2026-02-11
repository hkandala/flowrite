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
