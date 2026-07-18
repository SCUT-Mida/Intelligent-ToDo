<#
.SYNOPSIS
    Launches a new Windows Terminal tab (or fallback PowerShell window) for a repo.
.DESCRIPTION
    Builds the appropriate command-line arguments for wt.exe and launches it.
    If wt.exe is not found and fallbackToPowerShellExe is enabled, uses
    powershell.exe directly as a fallback.
.PARAMETER Path
    The working directory (repo path) for the new terminal session.
.PARAMETER Command
    The command string to execute (e.g., "git pull; opencode").
.PARAMETER Mode
    How to open: "new-tab" (default) or "new-window".
.PARAMETER Config
    The config object (used for fallbackToPowerShellExe setting).
.OUTPUTS
    System.String. A status message indicating what was launched.
#>
function Invoke-WtCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Command,

        [Parameter(Mandatory = $false)]
        [ValidateSet("new-tab", "new-window")]
        [string]$Mode = "new-tab",

        [Parameter(Mandatory = $false)]
        [PSCustomObject]$Config = $null
    )

    # Check if wt.exe is available
    $wtAvailable = $null -ne (Get-Command "wt.exe" -ErrorAction SilentlyContinue)

    if ($wtAvailable) {
        # Build wt.exe arguments
        $wtArgs = @()

        if ($Mode -eq "new-tab") {
            $wtArgs += "new-tab"
        } else {
            $wtArgs += "new-window"
        }

        $wtArgs += "-d"
        $wtArgs += "`"$Path`""
        $wtArgs += "powershell"
        $wtArgs += "-NoExit"
        # CRITICAL: Use -EncodedCommand instead of -Command.
        # wt.exe treats ';' as its own action separator (e.g. "wt new-tab ; split-pane").
        # A template like "git pull; opencode" gets split into two wt actions,
        # and the second one (" opencode"") is interpreted as a program name -> ERROR_FILE_NOT_FOUND (0x80070002).
        # Base64 (UTF-16LE) contains only [A-Za-z0-9+/=], no semicolons/spaces/quotes -> wt cannot misparse.
        $wtArgs += "-EncodedCommand"
        $commandBytes = [System.Text.Encoding]::Unicode.GetBytes($Command)
        $encodedCommand = [Convert]::ToBase64String($commandBytes)
        $wtArgs += $encodedCommand

        $argString = $wtArgs -join " "

        Write-Verbose "Launching: wt.exe $argString"
        Start-Process -FilePath "wt.exe" -ArgumentList $argString
    } else {
        # wt.exe not found
        $fallbackEnabled = $false
        if ($null -ne $Config) {
            $fallbackEnabled = [bool]($Config.fallbackToPowerShellExe)
        }

        if ($fallbackEnabled) {
            Write-Warning "wt.exe not found. Falling back to powershell.exe."
            $psArgs = @(
                "-NoExit"
                "-Command"
                "`"$Command`""
            )
            Start-Process -FilePath "powershell.exe" -WorkingDirectory $Path -ArgumentList $psArgs
        } else {
            Write-Warning "wt.exe not found and fallback is disabled. Config suggests enabling fallbackToPowerShellExe."
            return "FAILED: wt.exe not found"
        }
    }

    return "Launched terminal at '$Path' with: $Command"
}
