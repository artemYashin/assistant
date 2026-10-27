# Run from the existing checkout. WSL keeps the Bash/storage workflow shared.
param([string]$Distribution = 'Ubuntu')
$ErrorActionPreference = 'Stop'
try {
    if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
        throw 'Install WSL: wsl --install -d Ubuntu (administrator terminal), reboot, create your Linux user, then rerun.'
    }
    & wsl.exe -d $Distribution --exec true
    if ($LASTEXITCODE -ne 0) {
        & wsl.exe --install -d $Distribution
        throw 'Finish WSL installation/reboot and create your Linux user, then rerun this script.'
    }
    & wsl.exe -d $Distribution --exec docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        # A working Windows engine only needs WSL integration; do not install another engine.
        $docker = Get-Command docker -ErrorAction SilentlyContinue
        if ($docker) {
            throw 'Docker is installed. Start it and enable integration with your WSL distribution, then rerun. Existing settings were preserved.'
        }
        $rdctl = @(
            "$env:ProgramFiles\Rancher Desktop\resources\resources\win32\bin\rdctl.exe",
            "$env:LOCALAPPDATA\Programs\Rancher Desktop\resources\resources\win32\bin\rdctl.exe"
        ) | Where-Object { Test-Path $_ } | Select-Object -First 1
        if ($rdctl) {
            throw 'Rancher is already installed. Start it with Moby and enable WSL integration, then rerun.'
        }
        if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
            throw 'Install App Installer (winget) or Rancher Desktop manually, then rerun.'
        }
        & winget install --id SUSE.RancherDesktop --exact --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) { throw 'Rancher installation failed. Check the installer output.' }
        $rdctl = @(
            "$env:ProgramFiles\Rancher Desktop\resources\resources\win32\bin\rdctl.exe",
            "$env:LOCALAPPDATA\Programs\Rancher Desktop\resources\resources\win32\bin\rdctl.exe"
        ) | Where-Object { Test-Path $_ } | Select-Object -First 1
        if (-not $rdctl) { throw 'Open Rancher Desktop, select Moby, disable Kubernetes, enable WSL integration, then rerun.' }
        & $rdctl start --container-engine.name=moby --kubernetes.enabled=false
        if ($LASTEXITCODE -ne 0) { throw 'Could not start Rancher Desktop.' }
        $settingsText = & $rdctl list-settings
        if ($LASTEXITCODE -ne 0) { throw 'Rancher is still starting. Wait and enable WSL integration, then rerun.' }
        $settings = ($settingsText -join "`n") | ConvertFrom-Json
        $integrations = @{}
        $integrations[$Distribution] = $true
        $body = @{ version = $settings.version; WSL = @{ integrations = $integrations } } | ConvertTo-Json -Depth 5 -Compress
        $settingsFile = [System.IO.Path]::GetTempFileName()
        try {
            [System.IO.File]::WriteAllText($settingsFile, $body, (New-Object System.Text.UTF8Encoding($false)))
            & $rdctl api /v1/settings --method PUT --input $settingsFile
            if ($LASTEXITCODE -ne 0) { throw 'Enable WSL integration in Rancher Preferences, then rerun.' }
        } finally {
            Remove-Item $settingsFile -ErrorAction SilentlyContinue
        }
        for ($attempt = 0; $attempt -lt 120; $attempt++) {
            & wsl.exe -d $Distribution --exec docker info *> $null
            if ($LASTEXITCODE -eq 0) { break }
            Start-Sleep -Seconds 2
        }
        if ($LASTEXITCODE -ne 0) { throw 'Docker is not ready in WSL. Check Rancher WSL integration, then rerun.' }
    }
    if ($PSScriptRoot -match '^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\(.*)$') {
        if ($Matches[1] -ne $Distribution) { throw 'Use -Distribution matching the WSL checkout location.' }
        $linuxRoot = '/' + $Matches[2].Replace('\', '/')
    } else {
        $linuxRoot = & wsl.exe -d $Distribution --exec wslpath -a $PSScriptRoot
        if ($LASTEXITCODE -ne 0) { throw 'Could not resolve this checkout in WSL.' }
    }
    & wsl.exe -d $Distribution --cd $linuxRoot.Trim() --exec bash ./install.sh
    if ($LASTEXITCODE -ne 0) { throw 'Orbit startup failed; see the output above.' }
    Write-Host 'Orbit successfully started: http://localhost:43871'
} catch {
    Write-Host "ERROR: $_" -ForegroundColor Red
    Write-Host 'Startup NOT confirmed. No repository was cloned and no storage was reset.'
    exit 1
}
