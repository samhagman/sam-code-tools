---
name: update-sam-code-tools
description: Pull the latest versions of Sam's sam-code-tools plugins (mods and skills) into a running Claude Code session without restarting. Use when Sam says "update my plugins", "get the latest usage-burn", "pull sam-code-tools", or a sam-code-tools plugin seems out of date.
---

# Updating sam-code-tools in a running session

`/reload-plugins` only reloads what is already on disk; it never fetches. Getting an update is fetch → install → reload.

## Steps

1. Run the script (all installed sam-code-tools plugins, or name some):

   ```bash
   "${CLAUDE_PLUGIN_ROOT}/skills/update-sam-code-tools/scripts/update.sh"
   "${CLAUDE_PLUGIN_ROOT}/skills/update-sam-code-tools/scripts/update.sh" usage-burn
   ```

   It refreshes the marketplace, runs `claude plugin update` for each plugin, and prints `UPDATED` / `current` per plugin with versions.

2. If anything says `UPDATED`, ask Sam to type `/reload-plugins`. Agents can't run slash commands. If the new behaviour still doesn't show after that, a restart of the session applies it.

3. If everything says `current` but Sam expects a change, the author probably pushed without bumping `version` in the plugin's `.claude-plugin/plugin.json`. Installs are cached by version, so bump it, push, and rerun.

## Manual equivalent

```bash
claude plugin marketplace update sam-code-tools
claude plugin update <plugin>@sam-code-tools
```
then `/reload-plugins`.
