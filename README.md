# sam-code-tools

Sam's personal Claude Code marketplace: small mods and skills, each its own plugin, so every machine installs only what it wants.

## Install

```
/plugin marketplace add samhagman/sam-code-tools
/plugin install usage-burn@sam-code-tools
```

Private repo: run `gh auth login` on the machine first.

## Layout

```
.claude-plugin/marketplace.json   the catalog: one entry per installable thing
plugins/<name>/                   mods (own plugin.json + hooks)
skills/<name>/SKILL.md            single skills; wrap with an entry like:
                                  { "name": "<name>", "source": "./", "strict": false,
                                    "skills": ["./skills/<name>"] }
```

A bundle entry can list several skill paths to install a set at once.

## Contents

| Plugin | Kind | What it does |
|---|---|---|
| usage-burn | mod | 1h / 5h usage band above the prompt; click for a 7-day burn-down with hover, zoom, resets and a 48h-weighted run-out projection |
