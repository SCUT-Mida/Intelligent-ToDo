<#
.SYNOPSIS
    Fuzzy-matches a repo name or relative path against the index and returns its full path.
.DESCRIPTION
    Loads the index and filters repos where name or relativePath matches the
    search string using -like with wildcards (case-insensitive).
    Throws if 0 matches or if >1 matches (ambiguity).
.PARAMETER Name
    The partial repo name or relative path to search for (case-insensitive).
.OUTPUTS
    System.String. The full path of the uniquely matched repo.
#>
function Resolve-RepoPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true, Position = 0)]
        [string]$Name
    )

    $userDir = Join-Path -Path $env:USERPROFILE -ChildPath ".repo-navigator"
    $indexPath = Join-Path -Path $userDir -ChildPath "index.json"

    if (-not (Test-Path -LiteralPath $indexPath)) {
        throw "Index not found at '$indexPath'. Run Update-RepoIndex first."
    }

    $rawJson = Get-Content -Path $indexPath -Raw -ErrorAction Stop
    $index = $rawJson | ConvertFrom-Json
    $repos = $index.repos

    if ($null -eq $repos) {
        throw "Index is empty or corrupted. Run Update-RepoIndex to refresh."
    }

    # Ensure repos is an array even if only one item
    if ($repos -isnot [array]) {
        $repos = @($repos)
    }

    # Fuzzy match: name or relativePath contains the search string
    $pattern = "*$Name*"
    $matches = @($repos | Where-Object {
        $_.name -like $pattern -or $_.relativePath -like $pattern
    })

    if ($matches.Count -eq 0) {
        throw "No repo found matching '$Name'. Run Update-RepoIndex to refresh."
    }

    if ($matches.Count -eq 1) {
        return $matches[0].path
    }

    # Multiple matches - throw with list of candidates
    $candidateList = $matches | ForEach-Object { "  - $($_.name) ($($_.path))" }
    $candidateStr = $candidateList -join "`n"
    throw "Multiple repos match '$Name':`n$candidateStr"
}
