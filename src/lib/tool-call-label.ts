import type { ToolCall } from "@/store/agent-store";

/** Extract a clean file name from a location path like "/a/b/file.md:0" */
export const cleanLocation = (
  location: string,
): { name: string; line: string | null; fullPath: string } => {
  const colonMatch = location.match(/^(.+?):(\d+(?::\d+)?)$/);
  const path = colonMatch ? colonMatch[1] : location;
  const linePart = colonMatch ? colonMatch[2] : null;

  const name = path.split("/").filter(Boolean).pop() || path;
  const line = linePart && linePart !== "0" ? linePart : null;

  return { name: name.toLowerCase(), line, fullPath: path };
};

/** Verb forms: [present participle, past tense, infinitive] */
const VERB_FORMS: Record<string, [string, string, string]> = {
  read: ["reading", "read", "read"],
  edit: ["editing", "edited", "edit"],
  delete: ["deleting", "deleted", "delete"],
  search: ["searching", "searched", "search"],
  execute: ["running", "ran", "run"],
  fetch: ["fetching", "fetched", "fetch"],
  think: ["thinking", "thought", "think"],
  move: ["moving", "moved", "move"],
};

export type VerbTense = "auto" | "infinitive";

export const getVerb = (
  kind: string,
  status: string,
  tense: VerbTense = "auto",
): string => {
  const forms = VERB_FORMS[kind];
  if (tense === "infinitive") return forms?.[2] ?? "run";
  if (!forms) {
    if (status === "completed") return "ran";
    if (status === "failed") return "failed to run";
    return "running";
  }
  if (status === "completed") return forms[1];
  if (status === "failed") return `failed to ${forms[2]}`;
  return forms[0];
};

const GENERIC_TITLES = [
  "read",
  "write",
  "edit",
  "delete",
  "search",
  "find",
  "execute",
  "run",
  "bash",
  "fetch",
  "think",
  "move",
  "tool",
  "task",
  "list",
  "undefined",
  ".",
];

/** Tool/command names that should show "ran X" instead of "searched X" */
const COMMAND_NAMES = new Set([
  "glob",
  "grep",
  "find",
  "ls",
  "cat",
  "rg",
  "ag",
  "fd",
]);

/** Strip wrapping literal quotes from a title: `"foo"` -> `foo` */
const stripQuotes = (s: string): string => s.replace(/^"(.*)"$/, "$1");

/**
 * Extract the glob/grep pattern from structured search titles like:
 *   "Find `/path/to/dir` `**\/*.tsx`" → "**\/*.tsx"
 *   "grep \"pattern\" /path" → "pattern"
 *   "`grep -r \"pattern\" /path`" → "pattern"
 *   "`find /path -name \"*.ts\"`" → "*.ts"
 */
const extractSearchPattern = (title: string): string | null => {
  // Glob-style: "find `path` `pattern`" — two backtick pairs, extract the second
  const globMatch = title.match(/`[^`]+`\s+`([^`]+)`\s*$/);
  if (globMatch) return globMatch[1];

  // Grep-style: grep/rg/ag ... "pattern" (with optional leading backtick)
  const grepMatch = title.match(
    /(?:^`?\s*)(?:grep|rg|ag)\b.*?(?:\\?"([^"\\]+)\\?"|'([^']+)')/,
  );
  if (grepMatch) return grepMatch[1] || grepMatch[2];

  // find -name "pattern": extract the first -name argument
  const findMatch = title.match(/-name\s+(?:\\?"([^"\\]+)\\?"|'([^']+)')/);
  if (findMatch) return findMatch[1] || findMatch[2];

  return null;
};

/** Shell commands that are search operations (find/grep in Bash) */
const SEARCH_COMMANDS = new Set(["find", "grep", "rg", "ag", "fd"]);

/**
 * If the execute-kind title is a backtick-wrapped command starting with
 * a search command (find, grep, …), return the command name.
 */
const extractShellSearchCommand = (title: string): string | null => {
  const m = title.match(/^`\s*(find|grep|rg|ag|fd)\b/);
  return m && SEARCH_COMMANDS.has(m[1]) ? m[1] : null;
};

/** Extract just the domain from a URL string, stripping www. prefix */
const extractDomain = (url: string): string | null => {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

export const deriveLabel = (
  toolCall: ToolCall,
  tense: VerbTense = "auto",
): { verb: string; subject: string | null } => {
  const location = toolCall.locations?.[0];
  const loc = location ? cleanLocation(location) : null;
  const fileName = loc?.name || null;
  const lineRange = loc?.line ? `:${loc.line}` : "";

  const rawTitle = toolCall.title?.toLowerCase() || "";
  const title = stripQuotes(rawTitle);
  const isGeneric =
    GENERIC_TITLES.some((g) => title === g || title.startsWith(`${g} `)) ||
    title === "";
  const verb = getVerb(toolCall.kind, toolCall.status, tense);

  switch (toolCall.kind) {
    case "read": {
      const file = fileName || (!isGeneric && title) || "file";
      return { verb, subject: `${file}${lineRange}` };
    }
    case "edit": {
      const file = fileName || (!isGeneric && title) || "file";
      return { verb, subject: `${file}${lineRange}` };
    }
    case "delete": {
      const file = fileName || (!isGeneric && title) || "file";
      return { verb, subject: file };
    }
    case "search": {
      // Tool names like "glob", "grep" should show "ran glob" not "searched glob"
      if (COMMAND_NAMES.has(title)) {
        const execVerb = getVerb("execute", toolCall.status, tense);
        return { verb: execVerb, subject: title };
      }
      // Extract pattern from structured titles like "Find `path` `**/*.tsx`"
      const pattern = extractSearchPattern(title);
      if (pattern) return { verb, subject: pattern };
      const query = !isGeneric && title ? title : null;
      return { verb, subject: query };
    }
    case "execute": {
      // Shell find/grep commands should show as "searched" not "ran"
      const shellSearch = extractShellSearchCommand(title);
      if (shellSearch) {
        const searchVerb = getVerb("search", toolCall.status, tense);
        const pattern = extractSearchPattern(title);
        return { verb: searchVerb, subject: pattern };
      }
      const cmd = !isGeneric && title ? title : "command";
      return { verb, subject: cmd };
    }
    case "fetch": {
      const urlMatch = title.match(/(https?:\/\/\S+)/);
      if (urlMatch) {
        const domain = extractDomain(urlMatch[1]);
        return { verb, subject: domain ?? urlMatch[1] };
      }
      if (!isGeneric && title) {
        const searchVerb = getVerb("search", toolCall.status, tense);
        return { verb: searchVerb, subject: title };
      }
      return { verb, subject: null };
    }
    case "think": {
      if (!isGeneric && title) return { verb: title, subject: null };
      // Generic task: "working on a task" / "worked on a task"
      if (toolCall.status === "completed")
        return { verb: "worked on a task", subject: null };
      if (toolCall.status === "failed")
        return { verb: "failed to complete task", subject: null };
      return { verb: "working on a task", subject: null };
    }
    case "move": {
      const file = fileName || (!isGeneric && title) || "file";
      return { verb, subject: file };
    }
    default: {
      const fallback = fileName || (!isGeneric && title) || null;
      return { verb, subject: fallback };
    }
  }
};
