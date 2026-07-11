# PowerShell One-Click Builder & Installer for Windows
# Usage (run in PowerShell):
# irm https://raw.githubusercontent.com/snowmerak/pdfication/main/install.ps1 | iex

$isProjectDir = (Test-Path "wails.json") -and (Test-Path "main.go")

if ($isProjectDir) {
    Write-Host "=== Running installer from project workspace ===" -ForegroundColor Blue
    $projectDir = Get-Location
} else {
    Write-Host "=== Running installer via PowerShell (Cloning repo to temp workspace) ===" -ForegroundColor Blue
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Error "Error: git is required to clone the repository."
        exit 1
    }
    
    $tempDirName = "pdfication-build-" + (New-Guid).Guid.Substring(0, 8)
    $tempDir = Join-Path $env:TEMP $tempDirName
    New-Item -ItemType Directory -Path $tempDir | Out-Null
    
    git clone --depth 1 https://github.com/snowmerak/pdfication.git $tempDir
    $projectDir = $tempDir
}

# Backup directory location
$oldLocation = Get-Location
Set-Location $projectDir

try {
    Write-Host "=== Checking Dependencies ===" -ForegroundColor Blue
    if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
        Write-Error "Error: Go is not installed. Please install Go (v1.18+) first."
        exit 1
    }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Error "Error: Node.js/npm is not installed. Please install Node.js/npm first."
        exit 1
    }
    if (-not (Get-Command wails -ErrorAction SilentlyContinue)) {
        Write-Host "Installing Wails CLI..." -ForegroundColor Blue
        go install github.com/wailsapp/wails/v2/cmd/wails@latest
        $gopath = go env GOPATH
        $env:PATH += ";$gopath\bin"
    }

    Write-Host "=== Building Application (windows/amd64) ===" -ForegroundColor Blue
    wails build -platform windows/amd64

    Write-Host "=== Installing Binary and Desktop Shortcut ===" -ForegroundColor Blue
    $installDir = Join-Path $env:LOCALAPPDATA "pdfication"
    if (-not (Test-Path $installDir)) {
        New-Item -ItemType Directory -Path $installDir | Out-Null
    }

    $binPath = Join-Path $projectDir "build\bin\pdfication.exe"
    $destPath = Join-Path $installDir "pdfication.exe"
    Copy-Item -Path $binPath -Destination $destPath -Force

    # Create Desktop Shortcut via COM Shell
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\Pdfication.lnk")
    $Shortcut.TargetPath = $destPath
    $Shortcut.WorkingDirectory = $installDir
    $Shortcut.IconLocation = $destPath # Windows loads embedded icon directly from exe resources
    $Shortcut.Save()

    Write-Host "=== Installation Complete! ===" -ForegroundColor Green
    Write-Host "Pdfication desktop shortcut has been created successfully." -ForegroundColor Green
}
finally {
    Set-Location $oldLocation
    if (-not $isProjectDir) {
        Remove-Item -Path $projectDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
