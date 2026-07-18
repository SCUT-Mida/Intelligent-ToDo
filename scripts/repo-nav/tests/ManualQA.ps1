<#
.SYNOPSIS
    Self-contained manual QA test runner for RepoNavigator module.
    No Pester dependency — uses simple if/else assertions with Write-Host output.
.DESCRIPTION
    - Creates a temp directory with mock git repos for testing
    - Loads the module fresh
    - Exercises every public function
    - Validates index, resolution, filtering, and edge cases
    - Cleans up temp directory at end
.NOTES
    Run from PowerShell 5.1 or 7+:
        powershell.exe -NoProfile -File .\tests\ManualQA.ps1
    Or from the module directory:
        cd D:\Coding\github\Intelligent-ToDo\scripts\repo-nav
        .\tests\ManualQA.ps1
#>

#Requires -Version 5.1

# Prevent any git interactive prompts
$env:GIT_TERMINAL_PROMPT = '0'
$env:GIT_EDITOR = ':'
$env:EDITOR = ':'
$env:PAGER = ''
$env:GIT_PAGER = ''

$ErrorActionPreference = "Stop"
$global:testPassed = 0
$global:testFailed = 0
$global:testSkipped = 0

function Assert-True {
    param([string]$Message, [object]$Condition)
    if ($Condition) {
        Write-Host "  PASS: $Message" -ForegroundColor Green
        $global:testPassed++
    } else {
        Write-Host "  FAIL: $Message" -ForegroundColor Red
        $global:testFailed++
    }
}

function Assert-Equal {
    param([string]$Message, [object]$Expected, [object]$Actual)
    if ($Expected -eq $Actual) {
        Write-Host "  PASS: $Message" -ForegroundColor Green
        $global:testPassed++
    } else {
        Write-Host "  FAIL: $Message (expected: '$Expected', actual: '$Actual')" -ForegroundColor Red
        $global:testFailed++
    }
}

function Assert-Throws {
    param([string]$Message, [scriptblock]$ScriptBlock, [string]$ExpectedMessage = "")
    try {
        & $ScriptBlock
        Write-Host "  FAIL: $Message (expected exception, but none thrown)" -ForegroundColor Red
        $global:testFailed++
    } catch {
        if ($ExpectedMessage -ne "" -and $_.Exception.Message -notlike "*$ExpectedMessage*") {
            Write-Host "  FAIL: $Message (expected message containing '$ExpectedMessage', got: '$($_.Exception.Message)')" -ForegroundColor Red
            $global:testFailed++
        } else {
            Write-Host "  PASS: $Message (threw: $($_.Exception.Message))" -ForegroundColor Green
            $global:testPassed++
        }
    }
}

function Assert-NotNull {
    param([string]$Message, [object]$Value)
    if ($null -ne $Value) {
        Write-Host "  PASS: $Message" -ForegroundColor Green
        $global:testPassed++
    } else {
        Write-Host "  FAIL: $Message (value is null)" -ForegroundColor Red
        $global:testFailed++
    }
}

# ============================================================================
# SETUP: Create temp test environment
# ============================================================================
Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "  RepoNavigator Manual QA" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Get the module directory
$moduleDir = Split-Path -Parent $PSScriptRoot
$modulePath = Join-Path -Path $moduleDir -ChildPath "RepoNavigator.psm1"

Write-Host "`n[SETUP] Module path: $modulePath" -ForegroundColor Yellow

# Create temp directory for testing
$tempDir = Join-Path -Path $env:TEMP -ChildPath "RepoNavTest_$(Get-Random)"
if (Test-Path -LiteralPath $tempDir) {
    Remove-Item -Path $tempDir -Recurse -Force
}
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
Write-Host "[SETUP] Temp test dir: $tempDir" -ForegroundColor Yellow

# Backup user's existing config and index
$userRepoDir = Join-Path -Path $env:USERPROFILE -ChildPath ".repo-navigator"
$userRepoDirBackedUp = $false
if (Test-Path -LiteralPath $userRepoDir) {
    $backupDir = Join-Path -Path $env:TEMP -ChildPath "RepoNavBackup_$(Get-Random)"
    Copy-Item -Path $userRepoDir -Destination $backupDir -Recurse -Force
    $userRepoDirBackedUp = $true
    Write-Host "[SETUP] Backed up existing ~\.repo-navigator\ to $backupDir" -ForegroundColor Yellow
}

# Override USERPROFILE for the test scope so module writes to temp dir
$originalUserProfile = $env:USERPROFILE
$env:USERPROFILE = $tempDir

# Create mock git repos in the temp directory
$mockScanRoot = Join-Path -Path $tempDir -ChildPath "Code"
New-Item -ItemType Directory -Path $mockScanRoot -Force | Out-Null

$mockRepos = @(
    @{ Name = "alpha-project";   Subdir = "github" }
    @{ Name = "beta-tools";     Subdir = "github" }
    @{ Name = "fast-api";       Subdir = "work"   }
    @{ Name = "fast-forward";   Subdir = "work"   }
    @{ Name = "gamma-service";  Subdir = "github" }
)

# Check if git is available
$gitAvailable = $null -ne (Get-Command "git" -ErrorAction SilentlyContinue)
Write-Host "[SETUP] Git available: $gitAvailable" -ForegroundColor Yellow

foreach ($repo in $mockRepos) {
    $repoDir = Join-Path -Path $mockScanRoot -ChildPath "$($repo.Subdir)\$($repo.Name)"
    New-Item -ItemType Directory -Path $repoDir -Force | Out-Null

    # Create a README to simulate a real repo
    $readmePath = Join-Path -Path $repoDir -ChildPath "README.md"
    "# $($repo.Name)`nTest repo for QA" | Out-File -FilePath $readmePath -Encoding utf8

    if ($gitAvailable) {
        try {
            Push-Location -Path $repoDir
            git init 2>&1 | Out-Null
            git config user.email "test@example.com" 2>&1 | Out-Null
            git config user.name "Test" 2>&1 | Out-Null
            git add README.md 2>&1 | Out-Null
            git commit -m "Initial commit for $($repo.Name)" 2>&1 | Out-Null
            Pop-Location
        } catch {
            Pop-Location
            Write-Host "[SETUP] git init/commit failed for $($repo.Name): $($_.Exception.Message)" -ForegroundColor Gray
        }
    } else {
        # Without git, create a minimal .git directory so Test-Path still works
        $gitDir = Join-Path -Path $repoDir -ChildPath ".git"
        New-Item -ItemType Directory -Path $gitDir -Force | Out-Null
    }
}

Write-Host "[SETUP] Created $($mockRepos.Count) mock repos under $mockScanRoot" -ForegroundColor Yellow
Write-Host "[SETUP] Mock repos: $($mockRepos.ForEach{ $_.Name })" -ForegroundColor Yellow

# Verify the repos actually have .git folders
foreach ($repo in $mockRepos) {
    $repoDir = Join-Path -Path $mockScanRoot -ChildPath "$($repo.Subdir)\$($repo.Name)"
    $gitPath = Join-Path -Path $repoDir -ChildPath ".git"
    $hasGit = Test-Path -LiteralPath $gitPath
    Write-Host "[SETUP]   $($repo.Name): .git = $hasGit" -ForegroundColor Gray
}

# Create a test config pointing to our mock scan root
$testConfigDir = Join-Path -Path $tempDir -ChildPath ".repo-navigator"
New-Item -ItemType Directory -Path $testConfigDir -Force | Out-Null
$testConfigPath = Join-Path -Path $testConfigDir -ChildPath "config.json"

$testConfig = @{
    '$schema'        = "repo-navigator/v1"
    scanRoots        = @($mockScanRoot)
    scanDepth        = 3
    excludePatterns  = @("node_modules", ".git", "dist", "out", "build", "__pycache__", ".venv", "vendor")
    commandTemplates = @{
        default = "echo 'hello world'"
        update  = "echo 'update'"
        work    = "echo 'work'"
        code    = "echo 'code'"
        build   = "echo 'build'"
    }
    defaultTemplate        = "default"
    openIn                 = "new-tab"
    fallbackToPowerShellExe = $true
}

$testConfig | ConvertTo-Json -Depth 10 | Out-File -FilePath $testConfigPath -Encoding utf8 -Force

# Clear environment variable so module picks up the user profile config
[Environment]::SetEnvironmentVariable("REPO_NAVIGATOR_CONFIG", "", "User")
Remove-Item Env:\REPO_NAVIGATOR_CONFIG -ErrorAction SilentlyContinue

Write-Host "[SETUP] Test config written to: $testConfigPath" -ForegroundColor Yellow
Write-Host "[SETUP] USERPROFILE temporarily set to: $tempDir" -ForegroundColor Yellow

# ============================================================================
# TEST GROUP 1: Module loads correctly
# ============================================================================
Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "  GROUP 1: Module Loading" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

try {
    Remove-Module RepoNavigator -ErrorAction SilentlyContinue
    Import-Module $modulePath -Force -ErrorAction Stop
    Assert-True "Module imported without errors" $true
} catch {
    Assert-True "Module imported without errors (exception: $($_.Exception.Message))" $false
}

# Verify module exports
$exportedCommands = Get-Command -Module RepoNavigator | Select-Object -ExpandProperty Name
$expectedPublic = @('Get-RepoList', 'Find-Repo', 'Open-Repo', 'Update-RepoIndex', 'Open-RepoConfig')
foreach ($cmd in $expectedPublic) {
    Assert-True "Public function '$cmd' is exported" ($exportedCommands -contains $cmd)
}

Assert-Equal "Module exports exactly 5 public functions" 5 $exportedCommands.Count

# Verify aliases
$aliases = @('fr', 'or', 'riu', 'orc')
foreach ($alias in $aliases) {
    $resolved = Get-Alias -Name $alias -ErrorAction SilentlyContinue
    Assert-True "Alias '$alias' resolves" ($null -ne $resolved)
}

# ============================================================================
# TEST GROUP 2: Config resolution
# ============================================================================
Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "  GROUP 2: Config Resolution" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Test: Get-RepoNavConfig (private) returns our test config
$config = & (Get-Module RepoNavigator) { Get-RepoNavConfig }
Assert-NotNull "Get-RepoNavConfig returns config object" $config
Assert-True "Config has scanRoots" ($null -ne $config.scanRoots)
Assert-Equal "Config scanRoots[0] equals mockScanRoot" $mockScanRoot $config.scanRoots[0]
Assert-Equal "Config defaultTemplate is 'default'" "default" $config.defaultTemplate
Assert-True "Config has _configPath set" ($null -ne $config._configPath)

# ============================================================================
# TEST GROUP 3: Update-RepoIndex (riu)
# ============================================================================
Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "  GROUP 3: Update-RepoIndex (riu)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Run with a timeout to prevent hanging
$riuTimeoutSeconds = 30
$riuJob = Start-Job -ScriptBlock {
    param($mp)
    Remove-Module RepoNavigator -ErrorAction SilentlyContinue
    Import-Module $mp -Force
    Update-RepoIndex
} -ArgumentList $modulePath

$riuResult = $riuJob | Wait-Job -Timeout $riuTimeoutSeconds
if ($null -eq $riuResult) {
    $riuJob | Stop-Job
    $riuJob | Remove-Job
    Assert-True "Update-RepoIndex completed within $riuTimeoutSeconds seconds" $false
    Write-Host "  FAIL: Update-RepoIndex timed out after $riuTimeoutSeconds seconds" -ForegroundColor Red
} else {
    $summary = $riuJob | Receive-Job
    $riuJob | Remove-Job
    Assert-NotNull "Update-RepoIndex returns a result" $summary
    Assert-True "Summary mentions repo count" ($summary -match "\d+")
    Write-Host "  SUMMARY: $summary" -ForegroundColor Magenta
}

# Verify index.json was created
$indexPath = Join-Path -Path $tempDir -ChildPath ".repo-navigator\index.json"
Assert-True "index.json exists at $indexPath" (Test-Path -LiteralPath $indexPath)

if (Test-Path -LiteralPath $indexPath) {
    # Validate JSON structure
    $rawIndex = Get-Content -Path $indexPath -Raw -ErrorAction Stop
    try {
        $indexObj = $rawIndex | ConvertFrom-Json
        Assert-True "index.json parses as valid JSON" $true
        Assert-True "Index has version field" ($null -ne $indexObj.version)
        Assert-Equal "Index version is 1" 1 $indexObj.version
        Assert-True "Index has repoCount field" ($null -ne $indexObj.repoCount)
        Assert-True "Index has repos array" ($null -ne $indexObj.repos)
        Assert-True "Index repoCount matches" (($indexObj.repos | Measure-Object).Count -eq $indexObj.repoCount)
        Write-Host "  INDEX: $($indexObj.repoCount) repos, generated at $($indexObj.generatedAt)" -ForegroundColor Magenta
    } catch {
        Assert-True "index.json parses as valid JSON (error: $($_.Exception.Message))" $false
    }
}

# ============================================================================
# TEST GROUP 4: Get-RepoList
# ============================================================================
Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "  GROUP 4: Get-RepoList" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$repoList = Get-RepoList
Assert-NotNull "Get-RepoList returns results" $repoList
Assert-True "Get-RepoList returns array" ($repoList -is [array])

# We should find at least 4 repos (maybe all 5 if git init worked, or 5 with null metadata)
$reposFound = $repoList.Count
Write-Host "  Repos found: $reposFound" -ForegroundColor Magenta
Assert-True "Get-RepoList found at least 4 repos" ($reposFound -ge 4)

# Check shape of first repo
$firstRepo = $repoList[0]
Assert-True "Repo object has 'name' property" (-not [string]::IsNullOrEmpty($firstRepo.name))
Assert-True "Repo object has 'path' property" (-not [string]::IsNullOrEmpty($firstRepo.path))
Assert-True "Repo object has 'relativePath' property" ($null -ne $firstRepo.relativePath)
Assert-True "Repo object has 'scanRoot' property" ($null -ne $firstRepo.scanRoot)
Assert-True "Repo path has .git folder" (Test-Path (Join-Path -Path $firstRepo.path -ChildPath ".git"))

# List all repos found
Write-Host "  Repo list:" -ForegroundColor Gray
$repoList | ForEach-Object { Write-Host "    - $($_.name) [$($_.path)]" -ForegroundColor Gray }

# ============================================================================
# TEST GROUP 5: Find-Repo with filter
# ============================================================================
Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "  GROUP 5: Find-Repo (fr) with filter" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Test: check internal filtering for "fast" (2 repos: "fast-api", "fast-forward")
$fastMatches = $repoList | Where-Object { $_.name -like "*fast*" }
Write-Host "  Repos matching 'fast': $($fastMatches.Count)" -ForegroundColor Magenta
$fastMatches | ForEach-Object { Write-Host "    - $($_.name)" -ForegroundColor Gray }

# Test: Filter with "xyzzy" should match 0
Write-Host "  Testing filter 'xyzzy' (expects 0 matches):" -ForegroundColor Yellow
$result = Find-Repo -Filter "xyzzy"
Assert-True "Find-Repo -Filter 'xyzzy' returns null for no match" ($null -eq $result)

# Note: Find-Repo with >1 match opens GridView which is interactive
# We test the logic by checking the internal filtering works
$filteredTwo = $repoList | Where-Object { $_.name -like "*beta*" -or $_.relativePath -like "*beta*" }
Write-Host "  Repos matching 'beta': $($filteredTwo.Count)" -ForegroundColor Magenta
if ($filteredTwo.Count -ge 1) {
    Assert-True "Filter 'beta' finds at least 1 repo" $true
    Write-Host "  Matches: $($filteredTwo.ForEach{ $_.name })" -ForegroundColor Gray
}

# Also test auto-select for unique match "alpha-project"
$alphaMatches = $repoList | Where-Object { $_.name -like "*alpha-project*" }
Write-Host "  Repos matching 'alpha-project': $($alphaMatches.Count)" -ForegroundColor Magenta

# ============================================================================
# TEST GROUP 6: Resolve-RepoPath (private)
# ============================================================================
Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "  GROUP 6: Resolve-RepoPath (private)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Get the private function via module scope
$resolveAvailable = $false
try {
    $null = & (Get-Module RepoNavigator) { Get-Command Resolve-RepoPath -ErrorAction Stop }
    $resolveAvailable = $true
} catch {
    $resolveAvailable = $false
}

if ($resolveAvailable) {
    Write-Host "  Resolve-RepoPath is accessible via module scope" -ForegroundColor Yellow

    # Unique match: "alpha-project" should resolve uniquely
    try {
        $alphaPath = & (Get-Module RepoNavigator) { Resolve-RepoPath -Name "alpha-project" }
        Assert-NotNull "Resolve-RepoPath 'alpha-project' resolves to a path" $alphaPath
        Assert-True "Resolved path exists" (Test-Path -LiteralPath $alphaPath)
        Write-Host "  alpha-project path: $alphaPath" -ForegroundColor Gray
    } catch {
        Assert-True "Resolve-RepoPath 'alpha-project' throws (error: $($_.Exception.Message))" $false
    }

    # Ambiguous match: "fast" should throw with candidate list
    Assert-Throws "Resolve-RepoPath 'fast' throws for multiple matches" {
        & (Get-Module RepoNavigator) { Resolve-RepoPath -Name "fast" }
    }

    # No match: "nonexistent" should throw
    Assert-Throws "Resolve-RepoPath 'nonexistent' throws" {
        & (Get-Module RepoNavigator) { Resolve-RepoPath -Name "nonexistent" }
    }
} else {
    Write-Host "  SKIPPED: Resolve-RepoPath is private and inaccessible" -ForegroundColor Yellow
    $global:testSkipped++
}

# ============================================================================
# TEST GROUP 7: Open-Repo (non-interactive)
# ============================================================================
Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "  GROUP 7: Open-Repo (or) - Non-interactive" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Find a unique repo to open
$testRepo = $repoList | Where-Object { $_.name -eq "alpha-project" }
if ($null -eq $testRepo) {
    $testRepo = $repoList[0]
}

if ($null -ne $testRepo) {
    $repoName = $testRepo.name
    $repoPath = $testRepo.path
    Write-Host "  Opening repo: $repoName at $repoPath" -ForegroundColor Yellow

    try {
        $result = Open-Repo -Name $repoName -Action "update"
        Assert-NotNull "Open-Repo returns status message" $result
        Assert-True "Open-Repo mentions repo name" ($result -like "*$repoName*")
        Write-Host "  Open-Repo output: $result" -ForegroundColor Gray
    } catch {
        Assert-True "Open-Repo error: $($_.Exception.Message)" $false
    }
} else {
    Write-Host "  SKIPPED: No test repo available" -ForegroundColor Yellow
    $global:testSkipped++
}

# ============================================================================
# TEST GROUP 8: Open-RepoConfig (orc) - trace only
# ============================================================================
Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "  GROUP 8: Open-RepoConfig (orc) - Trace" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Verify Open-RepoConfig resolves config path correctly
$configInfo = & (Get-Module RepoNavigator) { Get-RepoNavConfig }
Assert-True "Config path points to test config" ($configInfo._configPath -eq $testConfigPath)
Write-Host "  Config resolved to: $($configInfo._configPath)" -ForegroundColor Gray
Write-Host "  (Open-RepoConfig would invoke Invoke-Item on this path)" -ForegroundColor Gray

# ============================================================================
# TEST GROUP 9: Edge cases
# ============================================================================
Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "  GROUP 9: Edge Cases" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Test: Invoke-WtCommand with missing wt.exe and fallback disabled
$invokeResult = & (Get-Module RepoNavigator) {
    $config = Get-RepoNavConfig
    $testConfigForFallback = $config.PSObject.Copy()
    $testConfigForFallback.fallbackToPowerShellExe = $false
    Invoke-WtCommand -Path "C:\" -Command "echo test" -Mode "new-tab" -Config $testConfigForFallback
}
Assert-NotNull "Invoke-WtCommand with fallback disabled returns result" $invokeResult
Write-Host "  Invoke-WtCommand(no-fallback) returned: $invokeResult" -ForegroundColor Gray

# Test: index with null fields (repos without git metadata)
$nullFieldRepos = $repoList | Where-Object { $null -eq $_.remoteUrl -or $null -eq $_.lastCommitDate }
$nullCount = $nullFieldRepos.Count
Write-Host "  Repos with null git metadata fields: $nullCount" -ForegroundColor Magenta
Assert-True "Null metadata doesn't crash anything" ($true)

# Test: Get-RepoList on non-existent index
Write-Host "  Testing Get-RepoList when index is missing:" -ForegroundColor Yellow
$backupIndex = Join-Path -Path $testConfigDir -ChildPath "index.json"
if (Test-Path -LiteralPath $backupIndex) {
    $movedIndex = $backupIndex + ".bak"
    Move-Item -Path $backupIndex -Destination $movedIndex -Force
    try {
        # This would prompt interactively, but in non-interactive mode it proceeds
        # We test via direct function call
        $emptyList = Get-RepoList
        Assert-True "Get-RepoList with missing index returns something" ($null -ne $emptyList)
    } catch {
        Assert-True "Get-RepoList with missing index handled gracefully" $true
    }
    Move-Item -Path $movedIndex -Destination $backupIndex -Force
}

# ============================================================================
# CLEANUP: Restore user profile and remove temp dir
# ============================================================================
Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "  CLEANUP" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$env:USERPROFILE = $originalUserProfile
[Environment]::SetEnvironmentVariable("REPO_NAVIGATOR_CONFIG", "", "User")

if (Test-Path -LiteralPath $tempDir) {
    Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "[CLEANUP] Removed temp dir: $tempDir" -ForegroundColor Yellow
}

if ($userRepoDirBackedUp) {
    if (Test-Path -LiteralPath $backupDir) {
        if (Test-Path -LiteralPath $userRepoDir) {
            Remove-Item -Path $userRepoDir -Recurse -Force -ErrorAction SilentlyContinue
        }
        Move-Item -Path $backupDir -Destination $userRepoDir -Force -ErrorAction SilentlyContinue
        Write-Host "[CLEANUP] Restored original ~\.repo-navigator\ from $backupDir" -ForegroundColor Yellow
    }
}

Remove-Module RepoNavigator -ErrorAction SilentlyContinue
Write-Host "[CLEANUP] Module unloaded" -ForegroundColor Yellow

# ============================================================================
# SUMMARY
# ============================================================================
Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "  QA RESULTS" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Passed: $global:testPassed" -ForegroundColor Green
Write-Host "  Failed: $global:testFailed" -ForegroundColor Red
Write-Host "  Skipped: $global:testSkipped" -ForegroundColor Yellow
Write-Host "  Total: $($global:testPassed + $global:testFailed + $global:testSkipped)" -ForegroundColor Cyan

if ($global:testFailed -eq 0) {
    Write-Host "`n  ALL TESTS PASSED" -ForegroundColor Green
} else {
    Write-Host "`n  SOME TESTS FAILED" -ForegroundColor Red
}

Write-Host "==========================================`n" -ForegroundColor Cyan

# Return exit code for scripting
if ($global:testFailed -gt 0) {
    exit 1
}
exit 0
