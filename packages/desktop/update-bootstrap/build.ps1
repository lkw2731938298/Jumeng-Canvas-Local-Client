# Build JumengCanvas-Update.exe (.NET Framework 4.x csc)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
  $csc = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path $csc)) { throw "csc.exe not found (.NET Framework 4 required)" }

$outDir = Join-Path $here "dist"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$out = Join-Path $outDir "JumengCanvas-Update.exe"
$src = Join-Path $here "JumengCanvas-Update.cs"

& $csc /nologo /target:winexe /optimize+ /platform:anycpu `
  /reference:System.dll `
  /reference:System.Drawing.dll `
  /reference:System.Windows.Forms.dll `
  /out:$out `
  $src

if ($LASTEXITCODE -ne 0) { throw "csc failed exit=$LASTEXITCODE" }
$fi = Get-Item $out
$sizeKb = [math]::Round($fi.Length / 1KB, 1)
Write-Host "[ok] $($fi.FullName) ($sizeKb KB)"
