#!/usr/bin/env pwsh
# resumerank installer for Windows PowerShell.
#
#   irm https://raw.githubusercontent.com/alok-mishra143/resumerank/main/install.ps1 | iex
#
# Options (environment variables):
#   RESUMERANK_REPO    Git URL or GitHub slug to install from
#   RESUMERANK_REF     branch/tag to install (default: main)
#   RESUMERANK_DIR     where the app lives (default: ~/.resumerank-app)
#   RESUMERANK_BIN     where the launcher goes (default: ~/AppData/Local/resumerank/bin)
#   RESUMERANK_HOME    where your data lives (default: ~/.resumerank)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = if ($env:RESUMERANK_REPO) { $env:RESUMERANK_REPO } else { "https://github.com/alok-mishra143/resumerank" }
$ref = if ($env:RESUMERANK_REF) { $env:RESUMERANK_REF } else { "main" }
$appDir = if ($env:RESUMERANK_DIR) { $env:RESUMERANK_DIR } else { Join-Path $HOME ".resumerank-app" }
$binDir = if ($env:RESUMERANK_BIN) { $env:RESUMERANK_BIN } else { Join-Path $HOME "AppData\Local\resumerank\bin" }
$dataDir = if ($env:RESUMERANK_HOME) { $env:RESUMERANK_HOME } else { Join-Path $HOME ".resumerank" }

function Bold([string]$text) { Write-Host $text -ForegroundColor Cyan }
function Info([string]$text) { Write-Host "  $text" }
function Warn([string]$text) { Write-Host "  ! $text" -ForegroundColor Yellow }
function Die([string]$text) { throw $text }

function Need([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Die "$name is required but was not found on PATH"
  }
}

function Remove-DirectoryContents([string]$path) {
  if (Test-Path $path) {
    Get-ChildItem -LiteralPath $path -Force | Remove-Item -Recurse -Force
  }
}

function Copy-LocalRepo([string]$source, [string]$destination) {
  $excluded = @(".git", "node_modules", "corpus-real")
  $items = Get-ChildItem -LiteralPath $source -Force
  foreach ($item in $items) {
    if ($excluded -contains $item.Name) { continue }
    if ($item.Name -eq ".env" -or $item.Name -like ".env.*") { continue }
    Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $destination $item.Name) -Recurse -Force
  }
}

Bold "resumerank install (windows)"

Need node
Need npm
Need tar

$nodeVersion = (& node -v).Trim()
$nodeMajor = [int]((& node -p "process.versions.node.split('.')[0]").Trim())
if ($nodeMajor -lt 20) {
  Die "Node.js 20 or newer is required (found $nodeVersion). Install it from https://nodejs.org."
}
Info "node $nodeVersion"

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("resumerank-install-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $zipPath = Join-Path $tmp "src.zip"
  $unpackDir = Join-Path $tmp "unpack"
  $downloaded = $false

  if ((Test-Path $repo) -and (Test-Path (Join-Path $repo "package.json"))) {
    Info "installing from the local checkout $repo"
    New-Item -ItemType Directory -Path $appDir -Force | Out-Null
    Remove-DirectoryContents $appDir
    Copy-LocalRepo $repo $appDir
  } else {
    $normalizedRepo = $repo.TrimEnd("/")
    $zipUrl = "$normalizedRepo/archive/refs/heads/$ref.zip"
    if ($repo -match "^[^/]+/[^/]+$") {
      $zipUrl = "https://github.com/$repo/archive/refs/heads/$ref.zip"
    }

    try {
      Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -TimeoutSec 120 | Out-Null
      $downloaded = $true
    } catch {
      Die "could not download $zipUrl"
    }

    if (-not $downloaded) {
      Die "could not download installer archive"
    }

    Info "downloaded $zipUrl"
    Expand-Archive -LiteralPath $zipPath -DestinationPath $unpackDir -Force
    $inner = Get-ChildItem -LiteralPath $unpackDir -Directory | Select-Object -First 1
    if (-not $inner) {
      Die "the downloaded archive had an unexpected layout"
    }

    if (Test-Path $appDir) {
      Remove-Item -LiteralPath $appDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $appDir -Force | Out-Null
    Copy-LocalRepo $inner.FullName $appDir
  }

  if (-not (Test-Path (Join-Path $appDir "package.json"))) {
    Die "no package.json in $appDir — wrong repo?"
  }

  Push-Location $appDir
  try {
    if (Test-Path (Join-Path $appDir "dist\resumerank.js")) {
      Info "installing runtime dependencies (prebuilt bundle found)..."
      & npm install --omit=dev --no-audit --no-fund --silent
    } else {
      Info "installing dependencies and building..."
      & npm install --no-audit --no-fund --silent
      & npm run build --silent
    }
  } finally {
    Pop-Location
  }

  if (-not (Test-Path (Join-Path $appDir "dist\resumerank.js"))) {
    Die "build did not produce dist/resumerank.js"
  }

  New-Item -ItemType Directory -Path $binDir -Force | Out-Null
  $launcher = Join-Path $binDir "resumerank.cmd"
  $launcherBody = @"
@echo off
node "$appDir\dist\resumerank.js" %*
"@
  Set-Content -LiteralPath $launcher -Value $launcherBody -Encoding Ascii
  Info "launcher: $launcher"

  New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
  Info "data dir: $dataDir"

  $version = "0.0.0"
  try {
    $version = (& $launcher --version).Trim()
  } catch {}

  $marker = @{
    version = $version
    installedAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
    mode = "install"
    dir = $appDir
    bin = $launcher
  } | ConvertTo-Json -Compress
  Set-Content -LiteralPath (Join-Path $appDir ".resumerank-install") -Value $marker -Encoding Utf8
  Info "install marker: $(Join-Path $appDir ".resumerank-install")"

  if ($version -ne "0.0.0") {
    Info "installed $version"
  } else {
    Warn "the launcher could not be executed — try: node $appDir\dist\resumerank.js --help"
  }

  $pathParts = ($env:PATH -split ";") | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
  if ($pathParts -notcontains $binDir) {
    Warn "$binDir is not on your PATH. Add it to PATH in Windows Environment Variables."
  }

  Write-Host ""
  Bold "Done. Next:"
  Write-Host "  resumerank ui                 # open the app in your browser (the normal way in)"
  Write-Host "  resumerank dashboard          # one self-contained HTML file you can send or print"
  Write-Host "  resumerank dash               # terminal dashboard, if you live in a shell"
  Write-Host "  resumerank add C:\path\to\resumes\*.pdf"
  Write-Host "  resumerank rank --title `"Senior Backend Engineer`" --jd job.md"
  Write-Host ""
  Write-Host "  Optional: add a TypeSafe (Jev) key in the UI under Settings for the typed extraction layer."
  Write-Host "  Without a key every feature still works, fully offline."
} finally {
  if (Test-Path $tmp) {
    Remove-Item -LiteralPath $tmp -Recurse -Force
  }
}
