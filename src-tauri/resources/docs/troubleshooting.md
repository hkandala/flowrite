# troubleshooting

solutions to common issues you might encounter with flowrite.

## agent won't connect

**symptom**: an agent doesn't appear in the agent selector, or shows a connection error.

**solutions**:

* make sure the agent's CLI is installed and accessible from your terminal. try running the agent's command directly (e.g., `claude`, `opencode`) to verify it works.
* make sure the agent is authenticated. most agents require you to log in through their own CLI before flowrite can use them.
* check the agent logs for error details (open agent settings and view logs).

## agent crashes

**symptom**: the agent stops responding mid-conversation or shows a crash notification.

**solutions**:

* use the restart option in the chat panel to relaunch the agent.
* check the agent logs for crash details.
* make sure you have a stable internet connection if the agent requires one for its LLM provider.
* try closing other agent sessions — flowrite supports up to 5 concurrent agent processes.

## files not appearing in file tree

**symptom**: files you created or added to `~/flowrite` don't show up in the file tree.

**solutions**:

* make sure the files are markdown (`.md`) files — flowrite only shows markdown files in the file tree.
* check that the files are in the `~/flowrite` directory (not a subdirectory of a different location).
* use refresh button on file tree to re-scan all your files.

## shortcuts not working

**symptom**: a keyboard shortcut doesn't do anything or triggers the wrong action.

**solutions**:

* make sure the cursor focus is in the right area. editor shortcuts only work when the cursor is in the editor, and chat shortcuts only work in the chat input.
* some shortcuts may conflict with macOS system shortcuts. check System Preferences > Keyboard > Shortcuts for conflicts.
* see the [keyboard shortcuts](./reference/keyboard-shortcuts.md) reference for the full list of available shortcuts.

## nb initialization issues

**symptom**: flowrite shows an error related to nb or fails to create/manage files on first launch.

**solutions**:

* make sure you have an internet connection on first launch — flowrite downloads `nb` automatically.
* check that you have write permissions to `~/flowrite` and `~/.fwnb`.
* try deleting `~/.fwnb` and `~/.fwnbrc` and restarting flowrite to re-initialize.

## see also

* [faq](./faq.md) — quick answers to common questions
* [getting started](./getting-started.md) — setup and first launch walkthrough
* [agent configuration](./reference/agent-configuration.md) — advanced agent setup
