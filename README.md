# flowrite

a markdown editor, reimagined for the age of ai agents.

## about

flowrite is an ai-native markdown editor with built-in support for ai agents via the agent client protocol (acp). connect any acp-compatible agent — claude code, opencode, codex, gemini cli, or your own — and let them read, edit, and review your documents alongside you.

### features

- rich markdown editing powered by platejs
- connect any acp-supported agent as a collaborator
- add comments and let agents resolve them
- ask agents to review your docs and leave feedback
- file tree with search and folder management
- markdown file management using `nb` cli
- tabbed multi-document workspace

## development

```bash
pnpm install
pnpm tauri dev
```

## build

```bash
pnpm tauri build
```
