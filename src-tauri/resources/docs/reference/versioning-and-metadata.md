# versioning & metadata

flowrite uses `nb`, [a command-line tool](https://xwmx.github.io/nb/), to manage markdown files. this gives you git-based versioning and metadata support without needing to interact with git directly.

## file versioning

every time you save a file, flowrite tracks the change through `nb`'s built-in git integration. this means your files have a version history — changes are recorded automatically as you work.

the `nb` tool is downloaded and configured automatically on first launch. you don't need to install or manage it yourself.

## file storage

your markdown files are stored in the `~/flowrite` directory. the internal data used by `nb` (index, git history) is stored separately in `~/.fwnb` and does not appear in your workspace.

## frontmatter metadata

flowrite uses YAML frontmatter at the top of markdown files to store metadata. this is the standard `---` delimited block at the beginning of a file:

```yaml
---
title: my document
tags: [notes, draft]
---
```

### supported metadata fields

* **title** — the document title, displayed in the file tree and tabs
* **tags** — a list of tags for organizing documents

### comments in frontmatter

inline comments and discussions are also stored in the frontmatter. this means comments travel with the file — if you move or share the file, comments are preserved. the comment data includes the quoted text (to anchor the comment to the right location) and the discussion thread.

you generally don't need to edit frontmatter manually — flowrite manages it for you when you add comments, change titles, or update tags.

## external changes

if you edit files in `~/flowrite` using another editor or from the terminal, flowrite detects the changes and updates the file tree and editor automatically. the file watcher runs in the background and picks up creates, edits, and deletes.

on launch, flowrite reconciles its index with the filesystem to catch any changes that happened while the app was closed.

## see also

* [managing files](../guides/managing-files.md) — file tree and file operations
* [comments & collaboration](../guides/comments-and-collaboration.md) — how comments work
* [faq](../faq.md) — common questions about file storage and data
