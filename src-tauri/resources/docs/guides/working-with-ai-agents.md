# working with ai agents

flowrite lets you collaborate with AI agents directly in the editor. agents can chat with you, read your files, suggest edits, leave comments, and more — all without switching to a separate app or terminal.

## how agents work in flowrite

flowrite automatically discovers all compatible AI agents installed on your system. if an agent's CLI is already installed and authenticated, flowrite connects to it directly — no extra setup needed on the flowrite side.

if an agent isn't installed yet, or requires authentication, you'll need to set that up separately before flowrite can use it. once the agent CLI is ready, flowrite picks it up automatically.

## available agents

flowrite works with any agent that supports the Agent Client Protocol, including:

* **Claude Code** — Anthropic's coding agent
* **OpenCode** — open-source agent supporting 75+ LLM providers
* **Codex** — OpenAI's coding agent
* **Gemini CLI** — Google's AI agent
* and any other ACP-compatible agent

## getting started for free with OpenCode

if you don't have any agents installed and want to try flowrite's AI features for free, OpenCode is a good place to start. it's open-source and supports many free models.

### install OpenCode

```bash
curl -fsSL https://opencode.ai/install | bash
```

you can also install via npm, brew, or other package managers — see [opencode.ai](https://opencode.ai) for details.

### set up authentication

after installing, authenticate with one of the supported providers:

* **GitHub** — log in with your GitHub account to use Copilot
* **OpenAI** — log in with your OpenAI account
* **any other provider** — OpenCode supports 75+ LLM providers through Models.dev, including many free options

once OpenCode is installed and authenticated, start a session in flowrite with OpenCode selected in the dropdown.

## using the chat

open the AI chat panel with `⌘⇧L`. the agent selector at the top lets you pick which agent to use.

type a message and press `Enter` to send it. the agent streams its response in real-time. use `Shift+Enter` to add a new line without sending.

### file references

give agents context about what you're working on by adding file references to your messages:

* press `⌘L` to add the current file to your chat message
* you can also select specific text and press `⌘L` to provide specific context
* you can right click on any file in file tree and click add to chat

the agent can then read those files and provide more relevant responses.

### starting a new chat

click the new chat button at the top of the chat panel to start a fresh conversation.

## viewing diffs

when an agent makes changes to a file, flowrite shows you the diff so you can see exactly what was modified. the diff viewer highlights additions and removals.

## tool call permissions

agents may request permission to perform actions like reading or editing files. when this happens, a permission dialog appears with details about what the agent wants to do. you can:

* **allow** — let the agent proceed with this action
* **always allow** — let the agent perform this type of action without asking again
* **reject** — deny the action

## plan tracking

some agents show their execution plan — a list of steps they intend to take. the plan appears in the chat with status indicators for each step (pending, in progress, completed).

## model and mode selection

if an agent supports multiple models or modes, you can switch between them from the chat input. for example, some agents offer different modes for planning vs. execution.

## see also

* [agent configuration](../reference/agent-configuration.md) — setting up custom agents, environment variables, and logs
* [comments & collaboration](./comments-and-collaboration.md) — having agents leave comments and review your docs
* [getting started](../getting-started.md) — quick walkthrough of core features
