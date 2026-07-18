<#
.SYNOPSIS
    Loads and returns the repo index as an array of repo objects.
.DESCRIPTION
    Reads index.json from ~\.repo-navigator\ and returns the repos array.
    If index.json is missing, prompts the user to build it first.
.OUTPUTS
    PSCustomObject[] with properties: Name, Path, RelativePath, ScanRoot,
    RemoteUrl, DefaultBranch, LastCommitDate, LastCommitMessage.
#>
function Get-RepoList {
    [CmdletBinding()]
    param()

    $userDir = Join-Path -Path $env:USERPROFILE -ChildPath ".repo-navigator"
    $indexPath = Join-Path -Path $userDir -ChildPath "index.json"

    if (-not (Test-Path -LiteralPath $indexPath)) {
        $response = Read-Host "Index not found. Build now? (Y/n)"
        if ($response -eq "" -or $response -eq "Y" -or $response -eq "y") {
            Update-RepoIndex
        } else {
            Write-Verbose "User declined index build."
            return @()
        }
    }

    if (-not (Test-Path -LiteralPath $indexPath)) {
        Write-Warning "Index still not available after build attempt."
        return @()
    }

    $rawJson = Get-Content -Path $indexPath -Raw -ErrorAction Stop
    $index = $rawJson | ConvertFrom-Json
    $repos = $index.repos

    if ($null -eq $repos) {
        return @()
    }

    # Ensure it's always an array
    if ($repos -isnot [array]) {
        $repos = @($repos)
    }

    return $repos
}
