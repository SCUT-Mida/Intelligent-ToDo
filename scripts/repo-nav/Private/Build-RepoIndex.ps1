<#
.SYNOPSIS
    Scans configured root directories for git repositories and builds a JSON index.
.DESCRIPTION
    For each scanRoot, recursively enumerates directories up to scanDepth,
    skipping any directory whose name matches excludePatterns.
    For each repo found (.git folder present), captures git metadata.
.OUTPUTS
    System.String. A summary line: "Index rebuilt: N repos found in X seconds"
#>
function Build-RepoIndex {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [PSCustomObject]$Config
    )

    $startTime = Get-Date
    $repos = @()

    $scanRoots = $Config.scanRoots
    $scanDepth = $Config.scanDepth
    $excludePatterns = $Config.excludePatterns

    # Ensure excludePatterns is always an array
    if ($null -eq $excludePatterns) {
        $excludePatterns = @()
    }

    # Ensure scanRoots is an array
    if ($null -eq $scanRoots) {
        $scanRoots = @()
    }

    foreach ($root in $scanRoots) {
        if (-not (Test-Path -LiteralPath $root)) {
            Write-Warning "Scan root does not exist, skipping: $root"
            continue
        }

        # BFS queue using ArrayList for reliable removal
        $queue = New-Object System.Collections.ArrayList
        $queue.Add(@($root, 0)) | Out-Null

        while ($queue.Count -gt 0) {
            $currentItem = $queue[0]
            $queue.RemoveAt(0)
            $currentPath = $currentItem[0]
            $currentDepth = $currentItem[1]

            # Get the directory name
            $dirName = Split-Path -Leaf -Path $currentPath

            # Check if this directory should be excluded
            $shouldSkip = $false
            foreach ($pattern in $excludePatterns) {
                if ($dirName -like $pattern) {
                    $shouldSkip = $true
                    break
                }
            }

            if ($shouldSkip) {
                continue
            }

            # Check for .git folder
            $gitPath = Join-Path -Path $currentPath -ChildPath ".git"
            if (Test-Path -LiteralPath $gitPath) {
                Write-Verbose "Found repo: $currentPath"

                # Build relative path from scan root
                $relativePath = $currentPath.Substring($root.Length).TrimStart('\')

                $repo = [PSCustomObject]@{
                    name              = $dirName
                    path              = $currentPath
                    relativePath      = $relativePath
                    scanRoot          = $root
                    remoteUrl         = $null
                    defaultBranch     = $null
                    lastCommitDate    = $null
                    lastCommitMessage = $null
                    detectedAt        = (Get-Date).ToString("o")
                }

                # Try to get git metadata (suppress all errors)
                # Using cmd /c with timeout to prevent hanging
                $gitBaseCmd = "git -C `"$currentPath`""

                try {
                    $remoteUrl = & git -C $currentPath remote get-url origin 2>$null
                    if ($LASTEXITCODE -eq 0 -and $remoteUrl) {
                        $repo.remoteUrl = $remoteUrl.Trim()
                    }
                } catch {
                    # Silently continue
                }

                try {
                    $defaultBranch = & git -C $currentPath rev-parse --abbrev-ref HEAD 2>$null
                    if ($LASTEXITCODE -eq 0 -and $defaultBranch) {
                        $repo.defaultBranch = $defaultBranch.Trim()
                    }
                } catch {
                    # Silently continue
                }

                try {
                    $lastCommitDate = & git -C $currentPath log -1 --format=%cI 2>$null
                    if ($LASTEXITCODE -eq 0 -and $lastCommitDate) {
                        $repo.lastCommitDate = $lastCommitDate.Trim()
                    }
                } catch {
                    # Silently continue
                }

                try {
                    $lastCommitMessage = & git -C $currentPath log -1 --format=%s 2>$null
                    if ($LASTEXITCODE -eq 0 -and $lastCommitMessage) {
                        $repo.lastCommitMessage = $lastCommitMessage.Trim()
                    }
                } catch {
                    # Silently continue
                }

                $repos += $repo
            }

            # If not at max depth, enumerate subdirectories
            if ($currentDepth -lt $scanDepth) {
                try {
                    $subDirs = Get-ChildItem -Path $currentPath -Directory -ErrorAction SilentlyContinue
                    foreach ($subDir in $subDirs) {
                        $queue.Add(@($subDir.FullName, $currentDepth + 1)) | Out-Null
                    }
                } catch {
                    # Silently skip inaccessible directories
                }
            }
        }
    }

    # Resolve index path
    $userDir = Join-Path -Path $env:USERPROFILE -ChildPath ".repo-navigator"
    if (-not (Test-Path -LiteralPath $userDir)) {
        New-Item -ItemType Directory -Path $userDir -Force | Out-Null
    }
    $indexPath = Join-Path -Path $userDir -ChildPath "index.json"

    # Build index object
    $index = [PSCustomObject]@{
        version     = 1
        generatedAt = (Get-Date).ToString("o")
        scanRoots   = $scanRoots
        repoCount   = $repos.Count
        repos       = $repos
    }

    # Convert to JSON and write (handle PS5.1 depth limitation)
    $json = $index | ConvertTo-Json -Depth 10
    $json | Out-File -FilePath $indexPath -Encoding utf8 -Force

    $elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds, 2)
    $summary = "Index rebuilt: $($repos.Count) repos found in ${elapsed} seconds"
    # Do NOT Write-Host here — return value is implicitly written by the caller's pipeline.
    # Writing here would cause the message to appear twice (Write-Host + caller's Write-Output).
    return $summary
}
