# One-step setup for Kuro Market. Safe to run again.
$ErrorActionPreference = "Continue"
$Repo = $PSScriptRoot
Set-Location $Repo

function Step($n, $text) { Write-Host ""; Write-Host "[$n/6] $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host ""; Write-Host "Setup stopped: $text" -ForegroundColor Red; exit 1 }

Step 1 "Checking git and Python"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail "git is not installed. Install it from https://git-scm.com and run setup again." }
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { Fail "Python is not installed. Install it from https://www.python.org and run setup again." }
Write-Host "OK"

Step 2 "Checking the GitHub CLI"
$Gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $Gh) {
    $Gh = Join-Path $env:ProgramFiles "GitHub CLI\gh.exe"
    if (-not (Test-Path $Gh)) {
        Write-Host "Installing GitHub CLI..."
        winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements
        if (-not (Test-Path $Gh)) { Fail "GitHub CLI didn't install. Install it from https://cli.github.com and run setup again." }
    }
}
Write-Host "OK ($Gh)"

Step 3 "Logging in to GitHub"
& $Gh auth status --hostname github.com *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "A browser window will open - log in to GitHub and approve. Come back here afterwards."
    & $Gh auth login --web --git-protocol https --hostname github.com
    if ($LASTEXITCODE -ne 0) { Fail "GitHub login didn't finish. Run setup again to retry." }
}
& $Gh auth setup-git --hostname github.com | Out-Null
$Login = "$(& $Gh api user --jq .login)".Trim()
if (-not $Login) { Fail "Couldn't read your GitHub username. Run setup again." }
Write-Host "Logged in as $Login"

Step 4 "Creating your GitHub repo"
if (-not (Test-Path (Join-Path $Repo ".git"))) { git init -q -b main }
if (-not (git config user.email)) {
    git config user.name $Login
    git config user.email "$Login@users.noreply.github.com"
}
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -q -m "setup: initial files" }
git remote get-url origin *> $null
if ($LASTEXITCODE -ne 0) {
    & $Gh repo view "$Login/kuro-market" *> $null
    if ($LASTEXITCODE -eq 0) {
        git remote add origin "https://github.com/$Login/kuro-market.git"
    } else {
        & $Gh repo create kuro-market --public --source . --remote origin
        if ($LASTEXITCODE -ne 0) { Fail "Couldn't create the repo on GitHub." }
    }
}
git pull -q --rebase origin main *> $null
git push -q -u origin HEAD
if ($LASTEXITCODE -ne 0) { Fail "Couldn't upload to GitHub." }
Write-Host "OK - https://github.com/$Login/kuro-market"

Step 5 "Starting the 30-minute price checks"
Start-Sleep -Seconds 3
& $Gh workflow enable price-check *> $null
& $Gh workflow run price-check
if ($LASTEXITCODE -ne 0) {
    Write-Host "Couldn't start the first check now - it will run on its own within 30 minutes." -ForegroundColor Yellow
} else {
    Write-Host "First check started (takes about a minute)."
}

Step 6 "Creating the desktop shortcut"
$Desktop = [Environment]::GetFolderPath("Desktop")
$Shell = New-Object -ComObject WScript.Shell
$Link = $Shell.CreateShortcut((Join-Path $Desktop "Kuro Market.lnk"))
$Link.TargetPath = Join-Path $Repo "start.bat"
$Link.WorkingDirectory = $Repo
$Link.WindowStyle = 7
$Link.Description = "Kuro market price dashboard"
$Link.Save()
Write-Host "OK"

Write-Host ""
Write-Host "Done - open 'Kuro Market' on your desktop." -ForegroundColor Green
