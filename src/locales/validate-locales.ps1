param(
    [string]$Folder = ".",
    [string]$Baseline = "en.json",
    [switch]$FailOnMissing,
    [switch]$FailOnExtra
)

function Write-Header {
    param([string]$Text)
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    Write-Host $Text -ForegroundColor White
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor DarkGray
}

function Flatten-Json {
    param(
        [Parameter(Mandatory = $true)] $Obj,
        [string]$Prefix = ""
    )

    $keys = New-Object System.Collections.Generic.List[string]
    if ($null -eq $Obj) { return @() }

    # helpers
    function Is-Map($x) {
        return ($x -is [System.Collections.IDictionary] -or
                $x -is [System.Collections.Specialized.OrderedDictionary])
    }

    function Is-Obj($x) {
        return ($x -is [System.Management.Automation.PSCustomObject])
    }

    function Is-Arr($x) {
        return (($x -is [System.Collections.IEnumerable]) -and ($x -isnot [string]))
    }

    if (Is-Map $Obj) {
        foreach ($key in $Obj.Keys) {
            $name  = if ($Prefix) { "$Prefix.$key" } else { "$key" }
            $value = $Obj[$key]

            if ((Is-Map $value) -or (Is-Obj $value)) {
                [string[]]$nested = Flatten-Json -Obj $value -Prefix $name
                $keys.AddRange($nested)
            }
            elseif (Is-Arr $value) {
                $i = 0
                foreach ($el in $value) {
                    $arrName = "$name`[$i`]"
                    if ((Is-Map $el) -or (Is-Obj $el)) {
                        [string[]]$nested = Flatten-Json -Obj $el -Prefix $arrName
                        $keys.AddRange($nested)
                    }
                    else {
                        $keys.Add($arrName)
                    }
                    $i++
                }
                if ($i -eq 0) { $keys.Add($name) }
            }
            else {
                $keys.Add($name)
            }
        }
    }
    elseif (Is-Obj $Obj) {
        foreach ($prop in $Obj.PSObject.Properties) {
            $name  = if ($Prefix) { "$Prefix.$($prop.Name)" } else { "$($prop.Name)" }
            $value = $prop.Value

            if ((Is-Map $value) -or (Is-Obj $value)) {
                [string[]]$nested = Flatten-Json -Obj $value -Prefix $name
                $keys.AddRange($nested)
            }
            elseif (Is-Arr $value) {
                $i = 0
                foreach ($el in $value) {
                    $arrName = "$name`[$i`]"
                    if ((Is-Map $el) -or (Is-Obj $el)) {
                        [string[]]$nested = Flatten-Json -Obj $el -Prefix $arrName
                        $keys.AddRange($nested)
                    }
                    else {
                        $keys.Add($arrName)
                    }
                    $i++
                }
                if ($i -eq 0) { $keys.Add($name) }
            }
            else {
                $keys.Add($name)
            }
        }
    }
    elseif (Is-Arr $Obj) {
        $i = 0
        foreach ($el in $Obj) {
            $arrName = if ($Prefix) { "$Prefix`[$i`]" } else { "[$i]" }
            if ((Is-Map $el) -or (Is-Obj $el)) {
                [string[]]$nested = Flatten-Json -Obj $el -Prefix $arrName
                $keys.AddRange($nested)
            }
            else {
                $keys.Add($arrName)
            }
            $i++
        }
    }
    else {
        if ($Prefix) { $keys.Add($Prefix) }
    }
    return $keys.ToArray()
}

function Load-JsonFile {
    param([string]$Path)
    try {
        $content = Get-Content -Raw -Path $Path -ErrorAction Stop
        return ($content | ConvertFrom-Json -ErrorAction Stop)
    } catch {
        Write-Host "❌ Failed to parse JSON: $Path" -ForegroundColor Red
        Write-Host "   $_" -ForegroundColor DarkRed
        return $null
    }
}

Write-Header "🌍 Locale keys checker — comparing against baseline '$Baseline'"

$baselinePath = Join-Path $Folder $Baseline
if (-not (Test-Path $baselinePath)) {
    Write-Host "❌ Baseline not found: $baselinePath" -ForegroundColor Red
    exit 1
}

$baseJson = Load-JsonFile $baselinePath
if ($null -eq $baseJson) { exit 2 }

$baseKeys = Flatten-Json $baseJson | Sort-Object
Write-Host "✅ Baseline loaded: $Baseline — total keys: $($baseKeys.Count)`n" -ForegroundColor Green

$files = Get-ChildItem -Path $Folder -Filter *.json -File | Where-Object { $_.Name -ne $Baseline }

if (-not $files) {
    Write-Host "⚠️ No locale files found." -ForegroundColor Yellow
    exit 0
}

$missingError = $false
$extraError   = $false

foreach ($f in $files) {
    Write-Host "`n🔎 Checking file: $($f.Name)" -ForegroundColor Cyan
    $json = Load-JsonFile $f.FullName
    if ($null -eq $json) { continue }

    $keys = Flatten-Json $json | Sort-Object

    $missing = $baseKeys | Where-Object { $keys -notcontains $_ }
    $extra   = $keys | Where-Object { $baseKeys -notcontains $_ }

    if ($keys.Count -gt $baseKeys.Count) {
        Write-Host "🟥 ERROR: $($f.Name) has MORE keys ($($keys.Count)) than baseline ($($baseKeys.Count))!" -ForegroundColor Red
        if ($extra.Count -gt 0) {
            Write-Host "   ➕ Extra keys ($($extra.Count)):" -ForegroundColor DarkRed
            foreach ($e in $extra) { Write-Host "      + $e" -ForegroundColor DarkRed }
        }
        $extraError = $true
    }
    elseif ($missing.Count -gt 0) {
        Write-Host "❌ Missing keys ($($missing.Count)):" -ForegroundColor Red
        foreach ($m in $missing) { Write-Host "      - $m" -ForegroundColor DarkRed }
        $missingError = $true
    }
    elseif ($extra.Count -gt 0) {
        Write-Host "⚠️ Warning: keys differ but count matches ($($extra.Count) extra keys)." -ForegroundColor Yellow
        foreach ($e in $extra) { Write-Host "      + $e" -ForegroundColor DarkYellow }
    }
    else {
        Write-Host "   ✅ Perfect! All keys match." -ForegroundColor Green
    }

    Write-Host "   ℹ️ Summary: baseline=$($baseKeys.Count) locale=$($keys.Count) missing=$($missing.Count) extra=$($extra.Count)" -ForegroundColor Gray
}

if ($FailOnMissing -and $missingError) {
    Write-Host "`n🚨 Failing: some locales have missing keys." -ForegroundColor Red
    exit 10
}
if ($FailOnExtra -and $extraError) {
    Write-Host "`n🚨 Failing: some locales have extra keys beyond baseline." -ForegroundColor Red
    exit 11
}

Write-Host "`n🎉 Done! Review discrepancies above." -ForegroundColor Magenta
