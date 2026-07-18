<#
.SYNOPSIS
    Interactively picks a repo via Out-GridView or fuzzy filter from CLI.
.DESCRIPTION
    Without -Filter: pipes all repos to Out-GridView -PassThru for interactive selection.
    With -Filter: pre-filters repos by name/path, then:
      - 0 matches: writes warning, returns null
      - 1 match: returns it (auto-selects)
      - >1 matches: pipes filtered list to Out-GridView -PassThru
    PS5.1 compatibility: always adds -Wait when used inside a function body.
.PARAMETER Filter
    Optional partial repo name to filter by (case-insensitive, wildcard matching).
.OUTPUTS
    PSCustomObject or $null. The selected repo object, or null if cancelled/no match.
#>
function Find-Repo {
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)]
        [string]$Filter = ""
    )

    # Load repos (may prompt if index missing)
    $repos = Get-RepoList
    if ($null -eq $repos -or $repos.Count -eq 0) {
        Write-Warning "No repos found in index. Run Update-RepoIndex first."
        return $null
    }

    # Ensure array
    if ($repos -isnot [array]) {
        $repos = @($repos)
    }

    if ([string]::IsNullOrEmpty($Filter)) {
        # No filter: show all in GridView
        $selected = $repos | Out-GridView -Title "Select Repo" -PassThru -Wait
        return $selected
    }

    # With filter: pre-filter by name or relativePath
    $pattern = "*$Filter*"
    $filtered = @($repos | Where-Object {
        $_.name -like $pattern -or $_.relativePath -like $pattern
    })

    if ($filtered.Count -eq 0) {
        Write-Warning "No repos match filter '$Filter'."
        return $null
    }

    # Ensure filtered is array for count check
    if ($filtered -isnot [array]) {
        $filtered = @($filtered)
    }

    if ($filtered.Count -eq 1) {
        # Auto-select single match
        return $filtered[0]
    }

    # Multiple matches: show in GridView
    $selected = $filtered | Out-GridView -Title "Select Repo (filtered: '$Filter')" -PassThru -Wait
    return $selected
}
