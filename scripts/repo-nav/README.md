# RepoNavigator

A standalone PowerShell module for scanning, indexing, and opening git repositories in new Windows Terminal tabs.

**Zero external dependencies.** Works on Windows PowerShell 5.1 and PowerShell 7+.

## Quick Start

```powershell
# Load the module
Import-Module ".\RepoNavigator.psm1" -Force

# View available commands
Get-Command -Module RepoNavigator

# First: edit config to set your scan roots
orc                    # opens config in default editor
# -> Set scanRoots to your dev directories (e.g., ["D:\\Coding", "C:\\Projects"])

# Build the repo index (scan roots for .git folders)
riu                    # alias for Update-RepoIndex

# List all indexed repos
Get-RepoList

# Find a repo interactively (Out-GridView)
fr                     # alias for Find-Repo (no args = GUI picker)
fr fast                # filter by name: auto-select if 1 match, GUI if many

# Open a repo in a new Windows Terminal tab
or                     # interactive picker then open
or fast                # open repo matching "fast"
or fast -Action code   # open with "code" template (git pull; code .)
or fast -Action update # open with "update" template (git pull --prune)
```

## Config

Config lives at `~\.repo-navigator\config.json` (auto-created from template on first use).

Config fields:
| Field | Description |
|-------|-------------|
| `scanRoots` | Array of root directories to scan for git repos |
| `scanDepth` | Max directory depth for recursive scanning (default: 3) |
| `excludePatterns` | Directory name patterns to skip |
| `commandTemplates` | Map of template names to command strings |
| `defaultTemplate` | Which template to use by default |
| `openIn` | `"new-tab"` or `"new-window"` |
| `fallbackToPowerShellExe` | If true, fall back to `powershell.exe` when `wt.exe` is unavailable |

## Commands

| Function | Alias | Description |
|----------|-------|-------------|
| `Get-RepoList` | - | List all indexed repos |
| `Find-Repo` | `fr` | Interactive repo picker (Out-GridView) |
| `Open-Repo` | `or` | Open repo in new terminal tab |
| `Update-RepoIndex` | `riu` | Rebuild the repo index |
| `Open-RepoConfig` | `orc` | Open config in default editor |

## Persistence

- Config: `~\.repo-navigator\config.json`
- Index:  `~\.repo-navigator\index.json` (auto-generated, do not edit manually)
