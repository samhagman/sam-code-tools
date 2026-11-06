# sam-code-tools

Small [Claude Code](https://claude.com/claude-code) mods and skills. Each one is its own plugin, so you install only what you want on each machine.

## Install

```
/plugin marketplace add samhagman/sam-code-tools
/plugin install usage-burn@sam-code-tools
/plugin install update-sam-code-tools@sam-code-tools
```

## Contents

| Plugin | Kind | What it does |
|---|---|---|
| usage-burn | mod | A small band above the prompt: how much of your account usage you spent in the last 1h and 5h. Click it for a burn-down chart of your weekly limit (up to 30 days of raw readings) with hover, zoom, reset markers and a projection of when you'd run out (7-day average, recent days weighted more; bad readings ignored). Pick any reading from the dropdown under the chart to delete it. The chart needs the desktop app; the terminal shows text. |
| update-sam-code-tools | skill | Fetches and installs the latest versions of these plugins in a running session, then tells you to `/reload-plugins`. |

## Updates

Turn on auto-update once per machine (`/plugin` → Marketplaces → sam-code-tools → Enable auto-update) to update at startup. In a long-running session, ask Claude to "update my sam-code-tools plugins" (uses the skill above), or run:

```
/plugin marketplace update sam-code-tools
/plugin   → Installed → <plugin> → Update
/reload-plugins
```

## Layout

```
.claude-plugin/marketplace.json   the catalog: one entry per installable plugin
plugins/<name>/                   mods (own plugin.json + hooks)
skills/<name>/SKILL.md            single skills, wrapped by a marketplace entry:
                                  { "name": "<name>", "source": "./", "strict": false,
                                    "skills": ["./skills/<name>"] }
```

## Contributing a change

1. Edit the plugin.
2. Bump `version` (in `plugins/<name>/.claude-plugin/plugin.json` for a mod, in the marketplace entry for a skill). Installs are cached by version, so a change without a bump never reaches anyone.
3. Commit and push.

## License

MIT
