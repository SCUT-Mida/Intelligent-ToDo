<#
.SYNOPSIS
    Rebuilds the repo index by scanning configured root directories.
.DESCRIPTION
    Loads configuration, then calls Build-RepoIndex to scan for git repos
    and write the index to ~\.repo-navigator\index.json.
    Outputs a summary line with repo count and elapsed time.
.OUTPUTS
    System.String. Summary line from Build-RepoIndex.
#>
function Update-RepoIndex {
    [CmdletBinding()]
    param()

    $config = Get-RepoNavConfig
    $result = Build-RepoIndex -Config $config
    return $result
}
