param(
  [Parameter(Mandatory=$true)][string]$HostPath,
  [string]$Output,
  [switch]$SharedDevice
)
$ErrorActionPreference='Stop'
$repo=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../../..')).Path
$sdk=Join-Path $repo 'crates/vue-native'
$ctl=Join-Path $sdk 'packages/vue-native/devtools/ctl.ts'
$binary=(Resolve-Path -LiteralPath $HostPath).Path
if(-not $Output){$Output=Join-Path $repo ('artifacts/native-media-editor-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))}
$out=[IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Force -Path $out,($out+'/profile'),($out+'/appdata'),($out+'/localappdata'),($out+'/dist') | Out-Null
& bun ($sdk+'/packages/vue-native/build.ts') ($PSScriptRoot+'/main.ts') ($out+'/dist') *> ($out+'/bundle.log')
if($LASTEXITCODE -ne 0){throw 'Editor fixture bundle failed; see bundle.log'}
$env:VN_DATA_DIR=$out+'/profile'
$env:APPDATA=$out+'/appdata'
$env:LOCALAPPDATA=$out+'/localappdata'
$env:VN_DIST=$out+'/dist'
$env:VN_APP_NAME='native-media-editor-proof'
$env:VN_SINGLE_INSTANCE='0'
$env:VN_WINDOW_FOCUS='never'
$env:VN_WINDOW='1440x1000'
$env:VN_OWNER_PID=[string]$PID
$env:VN_GPU_SHARED=if($SharedDevice){'1'}else{'0'}
$env:VN_LOG=if($SharedDevice){'info'}else{'warn'}
function Eval-Probe([string]$code) {
  $raw=& bun $ctl --dist ($out+'/dist') --timeout 10000 --json eval $code
  if($LASTEXITCODE -ne 0){throw ('Editor eval failed: '+($raw -join ' '))}
  $reply=($raw -join [Environment]::NewLine)|ConvertFrom-Json
  if(-not $reply.ok){throw 'Editor eval reply failed'}
  return ($reply.data.value|ConvertFrom-Json)
}
function State {
  $state=Eval-Probe 'JSON.stringify(globalThis.__nativeEditorProbe?.status()||null)'
  if($state.errors.Count -gt 0){throw ($state.errors -join [Environment]::NewLine)}
  return $state
}
function Wait-Ready {
  $deadline=[DateTime]::UtcNow.AddSeconds(40)
  do {
    $state=State
    if([DateTime]::UtcNow -gt $deadline){throw 'Editor startup timed out'}
    if(-not $state.ready){Start-Sleep -Milliseconds 100}
  }until($state.ready)
  Start-Sleep -Milliseconds 700
  return (State)
}
function Capture([string]$name) {
  & bun $ctl --dist ($out+'/dist') --timeout 10000 screenshot ($out+'/'+$name+'.png') *> ($out+'/'+$name+'-capture.json')
  if($LASTEXITCODE -ne 0){throw ('Screenshot failed: '+$name)}
}
function Snapshot([string]$name) {
  $pixels=Eval-Probe 'JSON.stringify(__nativeEditorProbe.snapshot())'
  $pixels|ConvertTo-Json -Depth 8|Set-Content -LiteralPath ($out+'/'+$name+'-pixels.json') -Encoding utf8
  Capture $name
  return $pixels
}
function Export([string]$name) {
  Eval-Probe 'JSON.stringify((__nativeEditorProbe.save(),true))'|Out-Null
  $deadline=[DateTime]::UtcNow.AddSeconds(30)
  do {
    $state=State
    if($state.export.state -eq 'error'){throw $state.export.message}
    if([DateTime]::UtcNow -gt $deadline){throw 'Editor export timed out'}
    if($state.export.state -ne 'done'){Start-Sleep -Milliseconds 100}
  }until($state.export.state -eq 'done')
  if($state.export.type -ne 'image/png' -or -not $state.export.previewAlive){throw 'Export lost preview ownership or returned a non-PNG'}
  $bytes=[Convert]::FromBase64String($state.export.png)
  if($bytes.Length -lt 8 -or $bytes[0] -ne 137 -or $bytes[1] -ne 80 -or $bytes[2] -ne 78 -or $bytes[3] -ne 71){throw 'Invalid PNG export'}
  [IO.File]::WriteAllBytes(($out+'/'+$name+'-export.png'),$bytes)
  $state.export.PSObject.Properties.Remove('png')
  $state|ConvertTo-Json -Depth 10|Set-Content -LiteralPath ($out+'/'+$name+'-export.json') -Encoding utf8
  return $state
}
function Close-Editor([string]$name) {
  Eval-Probe 'JSON.stringify((__nativeEditorProbe.close(),true))'|Out-Null
  $deadline=[DateTime]::UtcNow.AddSeconds(10)
  do {
    $state=State
    if([DateTime]::UtcNow -gt $deadline){throw 'Editor device/canvas did not release'}
    if(-not $state.lost -or $state.canvasCount -ne 0){Start-Sleep -Milliseconds 100}
  }until($state.lost -and $state.canvasCount -eq 0)
  $state.export=$null
  $state|ConvertTo-Json -Depth 8|Set-Content -LiteralPath ($out+'/'+$name+'-closed.json') -Encoding utf8
}
$child=$null
try {
  $child=Start-Process -FilePath $binary -WorkingDirectory $repo -PassThru -WindowStyle Hidden -RedirectStandardOutput ($out+'/stdout.log') -RedirectStandardError ($out+'/stderr.log')
  $deadline=[DateTime]::UtcNow.AddSeconds(30)
  do {
    $child.Refresh();if($child.HasExited){throw ('Probe exited: '+$child.ExitCode)}
    if([DateTime]::UtcNow -gt $deadline){throw 'Devtools handshake timed out'}
    Start-Sleep -Milliseconds 100
    $handshake=if(Test-Path -LiteralPath ($out+'/dist/devtools.json')){Get-Content -LiteralPath ($out+'/dist/devtools.json') -Raw|ConvertFrom-Json}else{$null}
  }until($handshake -and $handshake.pid -eq $child.Id)
  if($SharedDevice -and (Get-Content -LiteralPath ($out+'/stderr.log') -Raw) -notmatch 'WebGPU/GPUI share the same physical device via D3D11On12'){throw 'Host did not confirm shared native GPU identity'}
  $initial=Wait-Ready
  $initial|ConvertTo-Json -Depth 8|Set-Content -LiteralPath ($out+'/initial-state.json') -Encoding utf8
  $geometry=Eval-Probe 'JSON.stringify(__nativeEditorProbe.geometry())'
  $geometry|ConvertTo-Json -Depth 5|Set-Content -LiteralPath ($out+'/crop-geometry.json') -Encoding utf8
  Snapshot '01-avatar'|Out-Null
  Eval-Probe 'JSON.stringify((__nativeEditorProbe.tab("adjustments"),true))'|Out-Null
  Start-Sleep -Milliseconds 400
  $neutral=Snapshot '02-neutral'
  Eval-Probe 'JSON.stringify((__nativeEditorProbe.slider(),true))'|Out-Null
  Start-Sleep -Milliseconds 250
  $changed=Snapshot '03-brightness'
  $state=State
  if([Math]::Abs($state.brightness-0.4) -gt 0.02 -or $state.history -ne 1 -or $neutral.hash -eq $changed.hash){throw 'Pointer slider did not change GPU pixels as one history entry'}
  & bun $ctl --dist ($out+'/dist') key Ctrl+Z *> ($out+'/undo-key.json')
  if($LASTEXITCODE -ne 0){throw 'Undo key failed'}
  Start-Sleep -Milliseconds 250
  $undone=Snapshot '04-undo'
  if($undone.hash -ne $neutral.hash){throw 'Undo did not restore shader pixels'}
  Eval-Probe 'JSON.stringify((__nativeEditorProbe.crop(),true))'|Out-Null
  Start-Sleep -Milliseconds 300
  $crop=Snapshot '05-transformed'
  if($crop.hash -eq $undone.hash){throw 'Crop/rotation/mirror did not redraw'}
  $avatar=Export 'avatar'
  Close-Editor 'avatar'
  Eval-Probe 'JSON.stringify((__nativeEditorProbe.open("sticker"),true))'|Out-Null
  Wait-Ready|Out-Null
  $sticker=Snapshot '06-sticker'
  Eval-Probe 'JSON.stringify((__nativeEditorProbe.erase(),true))'|Out-Null
  Start-Sleep -Milliseconds 400
  $erased=Snapshot '07-mask'
  if($erased.transparent -le $sticker.transparent){throw 'Mask upload did not erase GPU pixels'}
  Eval-Probe 'JSON.stringify((__nativeEditorProbe.outline(),true))'|Out-Null
  Start-Sleep -Milliseconds 300
  $outlined=Snapshot '08-outline'
  if($outlined.hash -eq $erased.hash){throw 'Jump-flood outline did not affect pixels'}
  $expression=Export 'sticker'
  Close-Editor 'sticker'
  Eval-Probe 'JSON.stringify((__nativeEditorProbe.open("avatar"),true))'|Out-Null
  Wait-Ready|Out-Null
  Snapshot '09-reopened'|Out-Null
  Close-Editor 'reopened'
  [ordered]@{ok=$true;sharedDevice=[bool]$SharedDevice;pid=$child.Id;shader=$true;slider=$true;undo=$true;crop=$true;mask=$true;outline=$true;reopen=$true;avatar=@{width=$avatar.export.width;height=$avatar.export.height};sticker=@{width=$expression.export.width;height=$expression.export.height};output=$out}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath ($out+'/result.json') -Encoding utf8
  Get-Content -LiteralPath ($out+'/result.json')
} finally {
  if($child){
    $child.Refresh()
    if(-not $child.HasExited){Stop-Process -Id $child.Id;$child.WaitForExit(10000)|Out-Null}
    [ordered]@{pid=$child.Id;terminated=$child.HasExited}|ConvertTo-Json|Set-Content -LiteralPath ($out+'/cleanup.json') -Encoding utf8
  }
}
