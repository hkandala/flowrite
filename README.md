# flowrite

a markdown editor, reimagined for the age of ai agents.

## what is flowrite

flowrite is a markdown editor with built-in AI agent support. write, edit, and collaborate with AI agents directly in the editor — agents can read your docs, chat with you, leave comments, and make edits in place. connect any compatible agent like Claude Code, OpenCode, Codex, or Gemini CLI and start collaborating immediately.

## why flowrite

working with AI agents on documents today is fragmented. you write in one app, switch to your agent's terminal to ask for edits, copy the output back, paste it in, review the diff manually, and repeat. context is lost, flow is broken, and you spend more time managing the back-and-forth than actually writing.

flowrite was built to fix this. it brings AI collaboration directly into the editor — agents can read your files, suggest changes, leave inline comments, and respond to your feedback, all without leaving your writing environment.

## features

- **rich markdown editing** — headings, lists, code blocks, tables, todos, and more with autoformat shortcuts and slash commands
- **AI agent collaboration** — connect any compatible agent and chat, proofread, review, ask ai anything about your docs
- **inline comments** — add comments on any text, start discussion threads, and let agents reply or resolve them
- **file management** — file tree with search, folder organization, drag-and-drop, and support for external files
- **flexible workspace** — tabbed multi-document editing, split views, zen mode, and resizable panels
- **keyboard-driven** — comprehensive shortcuts for editing, navigation, and AI interaction

## installation

download the latest `.zip` file for macOS from the [releases page](https://github.com/hkandala/flowrite/releases/). extract the archive to get the `.app` file, then move it to your Applications folder.

## quick start

when you open flowrite for the first time, it automatically creates a `~/flowrite` directory. this is where all your markdown files are stored. you'll see the workspace with three main areas:

- **file tree** on the left — browse and manage your files
- **editor** in the center — write and edit markdown
- **right panel** — AI chat and comments (toggle with `⌘⇧L`)

press `⌘N` to create a new file, `⌘⇧L` to open the AI chat panel, and select text + `⌘D` to add a comment. see the [getting started guide](src-tauri/resources/docs/getting-started.md) for a full walkthrough.

## documentation

- [getting started](src-tauri/resources/docs/getting-started.md) — install flowrite and walk through the basics
- [editing markdown](src-tauri/resources/docs/guides/editing-markdown.md) — formatting, slash commands, code blocks, and more
- [managing files](src-tauri/resources/docs/guides/managing-files.md) — file tree, creating files, opening external files
- [workspace & layout](src-tauri/resources/docs/guides/workspace-and-layout.md) — panels, tabs, split views, zen mode
- [working with AI agents](src-tauri/resources/docs/guides/working-with-ai-agents.md) — connecting agents, chatting, diffs, permissions
- [comments & collaboration](src-tauri/resources/docs/guides/comments-and-collaboration.md) — inline comments, threads, AI feedback
- [keyboard shortcuts](src-tauri/resources/docs/reference/keyboard-shortcuts.md) — complete shortcut reference
- [agent configuration](src-tauri/resources/docs/reference/agent-configuration.md) — custom agents, environment variables, logs
- [versioning & metadata](src-tauri/resources/docs/reference/versioning-and-metadata.md) — file versioning, frontmatter, tags
- [troubleshooting](src-tauri/resources/docs/troubleshooting.md) — solutions to common issues
- [faq](src-tauri/resources/docs/faq.md) — frequently asked questions

## development

```bash
pnpm install
pnpm tauri dev
```

## build

```bash
pnpm tauri build
```
