<#
.SYNOPSIS
    RepoNavigator - PowerShell module for scanning, indexing, and opening git repos.
.DESCRIPTION
    Provides functions to:
    - Update-RepoIndex (riu): Scan root directories and build a repo index
    - Get-RepoList: Load and display the repo index
    - Find-Repo (fr): Interactively pick a repo via Out-GridView or filter
    - Open-Repo (or): Open a repo in a new Windows Terminal tab
    - Open-RepoConfig (orc): Open config in default editor

    All data stored in ~\.repo-navigator\ (config.json, index.json).
    Edit config.json to set scanRoots to your development directories.

.NOTES
    PowerShell 5.1+ and PowerShell 7+ compatible.
    Standalone module — no external dependencies.
    Windows-only (requires Out-GridView and wt.exe).
#>

# Ensure we're on Windows
if ($PSVersionTable.PSVersion.Major -ge 5) {
    # All good
} else {
    Write-Warning "RepoNavigator requires PowerShell 5.1 or later."
}

# Get the module root directory
$moduleRoot = $PSScriptRoot

# Resolve and dot-source all Private functions
$privatePath = Join-Path -Path $moduleRoot -ChildPath "Private"
if (Test-Path -LiteralPath $privatePath) {
    $privateFiles = Get-ChildItem -Path $privatePath -Filter "*.ps1" | Sort-Object Name
    foreach ($file in $privateFiles) {
        . $file.FullName
    }
}

# Resolve and dot-source all Public functions
$publicPath = Join-Path -Path $moduleRoot -ChildPath "Public"
if (Test-Path -LiteralPath $publicPath) {
    $publicFiles = Get-ChildItem -Path $publicPath -Filter "*.ps1" | Sort-Object Name
    foreach ($file in $publicFiles) {
        . $file.FullName
    }
}

# Export public functions
Export-ModuleMember -Function @(
    'Get-RepoList'
    'Find-Repo'
    'Open-Repo'
    'Update-RepoIndex'
    'Open-RepoConfig'
)

# Register aliases
Set-Alias -Name 'fr'   -Value 'Find-Repo'        -Scope Global
Set-Alias -Name 'or'   -Value 'Open-Repo'        -Scope Global
Set-Alias -Name 'riu'  -Value 'Update-RepoIndex' -Scope Global
Set-Alias -Name 'orc'  -Value 'Open-RepoConfig'  -Scope Global

Write-Verbose "RepoNavigator module loaded."
Write-Verbose "  Commands: Get-RepoList, Find-Repo (fr), Open-Repo (or), Update-RepoIndex (riu), Open-RepoConfig (orc)"
