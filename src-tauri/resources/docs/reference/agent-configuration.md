# agent configuration

this reference covers advanced agent configuration — setting up custom agents, configuring environment variables, and managing agent settings.

for a general overview of how agents work in flowrite, see [working with AI agents](../guides/working-with-ai-agents.md).

## agent registry

flowrite fetches a list of known agents from the [ACP registry](https://agentclientprotocol.com/get-started/registry). agents in the registry are pre-configured — flowrite knows the command to launch them and what capabilities they support. if the agent's CLI is installed on your system, it appears in the agent selector automatically.

## custom agents

you can add agents that aren't in the ACP registry by configuring them manually.  note that your agent must have ACP support. open the agent settings and add a new custom agent with:

* **name** — a display name for the agent
* **command** — the shell command to launch the agent (e.g., `my-agent serve`). this command shouldn’t invoke the TUI instead it should start the agent in ACP mode.

custom agents appear in the agent selector alongside registry agents.

## environment variables

some agents require environment variables for configuration (API keys, model settings, etc.). you can set environment variables per agent in the agent settings. these are passed to the agent process when flowrite launches it.

## authentication

different agents handle authentication differently:

* **Claude Code** — requires Anthropic API key or login via `claude` CLI
* **OpenCode** — supports GitHub, OpenAI, or custom provider login
* **Codex** — requires OpenAI authentication
* **Gemini CLI** — requires Google authentication

flowrite doesn't manage agent authentication directly. you need to set up authentication through each agent's own CLI or configuration before using it in flowrite. once authenticated, flowrite connects automatically.

## viewing agent logs

if an agent isn't working as expected, you can view its logs for debugging. access agent logs from the agent settings modal. logs include the agent's stdout/stderr output and communication with flowrite.

agent logs are stored in the application logs directory under an `acp/` subdirectory.

## removing agents

to remove a custom agent, open the agent settings and delete it. registry agents can't be removed, but they only appear if their CLI is installed on your system.

## see also

* [working with AI agents](../guides/working-with-ai-agents.md) — general guide to using agents
* [troubleshooting](../troubleshooting.md) — common agent issues and solutions
