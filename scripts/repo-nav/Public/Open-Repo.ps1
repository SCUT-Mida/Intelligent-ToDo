<#
.SYNOPSIS
    Opens a repo in a new Windows Terminal tab with a configurable command.
.DESCRIPTION
    If -Name is not provided, calls Find-Repo for interactive selection.
    If -Name is provided, resolves it via Resolve-RepoPath.
    Then launches the terminal with the configured command template.
.PARAMETER Name
    Optional repo name or partial name to open. Omit for interactive GUI selection.
.PARAMETER Action
    The command template key to use (default: the config's defaultTemplate).
    Examples: "default", "update", "work", "code", "build".
.OUTPUTS
    System.String. Status message about what was opened.
#>
function Open-Repo {
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)]
        [string]$Name = "",

        [Parameter(Position = 1)]
        [string]$Action = ""
    )

    # Load config
    $config = Get-RepoNavConfig
    $repoPath = $null
    $repoName = $null

    if ([string]::IsNullOrEmpty($Name)) {
        # Interactive mode via Find-Repo
        $selected = Find-Repo
        if ($null -eq $selected) {
            Write-Warning "No repo selected. Aborting."
            return $null
        }
        $repoPath = $selected.path
        $repoName = $selected.name
    } else {
        # Resolve name to path
        $repoPath = Resolve-RepoPath -Name $Name
        $repoName = Split-Path -Leaf -Path $repoPath
    }

    # Resolve command template
    if ([string]::IsNullOrEmpty($Action)) {
        $defaultTemplateKey = $config.defaultTemplate
        if ([string]::IsNullOrEmpty($defaultTemplateKey)) {
            $defaultTemplateKey = "default"
        }
    } else {
        $defaultTemplateKey = $Action
    }

    # Get the command string from templates
    $templates = $config.commandTemplates
    $command = $null

    if ($null -ne $templates) {
        # Access property by name (PSCustomObject)
        $command = $templates.$defaultTemplateKey
    }

    if ([string]::IsNullOrEmpty($command)) {
        $command = "git pull; opencode"
        Write-Warning "Command template '$defaultTemplateKey' not found. Using default: $command"
    }

    # Determine open mode
    $openMode = "new-tab"
    if (-not [string]::IsNullOrEmpty($config.openIn)) {
        $openMode = $config.openIn
    }

    # Launch terminal
    $result = Invoke-WtCommand -Path $repoPath -Command $command -Mode $openMode -Config $config
    $message = "Opening $repoName at $repoPath with: $command"
    Write-Host $message
    return $message
}
