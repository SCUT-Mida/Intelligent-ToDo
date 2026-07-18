<#
.SYNOPSIS
    Resolves the RepoNavigator configuration file path and returns the config object.
.DESCRIPTION
    Resolution order:
    1. $env:REPO_NAVIGATOR_CONFIG environment variable
    2. $env:USERPROFILE\.repo-navigator\config.json
    3. <module-dir>\config.example.json (default fallback)

    If no user config exists (paths 1 and 2), copies the template to the user
    profile location and loads that copy.
.OUTPUTS
    PSCustomObject with all configuration fields merged with defaults.
#>
function Get-RepoNavConfig {
    [CmdletBinding()]
    param()

    $moduleDir = $PSScriptRoot | Split-Path -Parent
    $templatePath = Join-Path -Path $moduleDir -ChildPath "config.example.json"

    # Determine config path by priority
    $configPath = $null

    # Priority 1: Environment variable
    $envConfig = [Environment]::GetEnvironmentVariable("REPO_NAVIGATOR_CONFIG")
    if ($envConfig -and (Test-Path -LiteralPath $envConfig)) {
        $configPath = $envConfig
    }

    # Priority 2: User profile location
    if ($null -eq $configPath) {
        $userDir = Join-Path -Path $env:USERPROFILE -ChildPath ".repo-navigator"
        $userConfig = Join-Path -Path $userDir -ChildPath "config.json"
        if (Test-Path -LiteralPath $userConfig) {
            $configPath = $userConfig
        }
    }

    # If no user config exists, copy template to user location
    if ($null -eq $configPath) {
        $userDir = Join-Path -Path $env:USERPROFILE -ChildPath ".repo-navigator"
        $userConfig = Join-Path -Path $userDir -ChildPath "config.json"

        if (-not (Test-Path -LiteralPath $userDir)) {
            New-Item -ItemType Directory -Path $userDir -Force | Out-Null
        }

        if (Test-Path -LiteralPath $templatePath) {
            Copy-Item -Path $templatePath -Destination $userConfig -Force
            Write-Host "Initialized default config at: $userConfig"
            Write-Host "  -> Edit scanRoots to match your environment, then run Update-RepoIndex"
            $configPath = $userConfig
        } else {
            # Last resort: use template path directly
            $configPath = $templatePath
        }
    }

    # Load and parse config
    if (-not (Test-Path -LiteralPath $configPath)) {
        throw "Configuration file not found at: $configPath"
    }

    $rawJson = Get-Content -Path $configPath -Raw -ErrorAction Stop
    $config = $rawJson | ConvertFrom-Json

    # Add the resolved config path to the object for reference
    $config | Add-Member -MemberType NoteProperty -Name "_configPath" -Value $configPath -Force

    return $config
}
