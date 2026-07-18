<#
.SYNOPSIS
    Opens the RepoNavigator configuration file in the default editor.
.DESCRIPTION
    Resolves the config path (via Get-RepoNavConfig) and invokes Invoke-Item
    to open it in the user's default JSON/editor application.
.OUTPUTS
    None. Side-effect only.
#>
function Open-RepoConfig {
    [CmdletBinding()]
    param()

    $config = Get-RepoNavConfig
    $configPath = $config._configPath

    if (-not (Test-Path -LiteralPath $configPath)) {
        throw "Config file not found at: $configPath"
    }

    Write-Host "Opening config file: $configPath"
    Invoke-Item -LiteralPath $configPath
}
