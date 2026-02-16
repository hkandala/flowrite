# faq

quick answers to frequently asked questions about flowrite.

## where are my files stored?

all your markdown files are stored locally in the `~/flowrite` directory. you can access this folder directly from Finder or the terminal. nothing is uploaded to the cloud.

## do I need an internet connection?

for writing and editing, no — flowrite works fully offline. you only need an internet connection if you're using an AI agent that connects to a cloud-based LLM provider. some agents support local models, which work without internet.

on the very first launch, flowrite downloads a small tool (`nb`) for markdown file management, which requires a brief internet connection.

## what AI agents can I use?

flowrite works with any agent that supports the Agent Client Protocol (ACP), including Claude Code, OpenCode, Codex, Gemini CLI, and others. see [working with AI agents](./guides/working-with-ai-agents.md) for details on setting up agents.

## is my data sent to the cloud?

flowrite itself does not send your data anywhere. your files stay on your local machine. however, if you use an AI agent, the agent may send file contents to its LLM provider to generate responses — this depends on the agent and provider you're using. check your agent's privacy policy for details.

## can I use flowrite without AI?

yes. flowrite is a fully functional markdown editor on its own. the AI features are optional — you can use it purely for writing and file management without ever connecting an agent.

## how do I back up my files?

since files are stored in `~/flowrite`, you can back them up with any backup tool or service that covers your home directory (Time Machine, cloud sync, etc.). the files are standard markdown, so they work with any tool that handles `.md` files.

flowrite also maintains git-based version history through `nb`, which provides an additional layer of protection against accidental changes. see [versioning & metadata](./reference/versioning-and-metadata.md) for more details.

## what file formats are supported?

flowrite works with markdown files (`.md`). it's designed specifically for markdown — other file formats are not supported.

## can I open files from outside the workspace?

yes. use `⌘O` to open any markdown file on your system, or type an absolute path in the command palette (`⌘P`). files opened from Finder also open in flowrite automatically if you set it as default app. see [managing files](./guides/managing-files.md) for details.

## see also

* [getting started](./getting-started.md) — setup and first launch walkthrough
* [troubleshooting](./troubleshooting.md) — solutions to common issues
