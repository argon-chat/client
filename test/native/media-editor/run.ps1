param(
  [Parameter(Mandatory=$true)][string]$HostPath,
  [string]$Output,
  [switch]$SharedDevice,
  [switch]$Readback
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
$env:VN_GPU_PRESENT=if($Readback){'readback'}else{'native'}
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
  $state=Eval-Probe 'JSON.stringify(__nativeEditorProbe.annotationState())'
  $state|ConvertTo-Json -Depth 8|Set-Content -LiteralPath ($out+'/'+$name+'-annotations.json') -Encoding utf8
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
function Wait-Settled {
  $deadline=[DateTime]::UtcNow.AddSeconds(5)
  do {
    $s=State;$target=if($s.tab -eq 'crop'){1}else{0}
    if([DateTime]::UtcNow -gt $deadline){throw 'Editor crop transition did not settle'}
    if([Math]::Abs($s.cropProgress-$target) -gt 0.00000001){Start-Sleep -Milliseconds 30}
  }until([Math]::Abs($s.cropProgress-$target) -le 0.00000001)
  Start-Sleep -Milliseconds 80
}
function Mouse([double]$x,[double]$y,[string]$kind,[switch]$Held,[int]$Clicks=1) {
  if($kind -eq 'down' -or $kind -eq 'click'){Wait-Settled}
  $mouseArgs=@($ctl,'--dist',($out+'/dist'),'--timeout','10000','mouse','--x',[string][Math]::Round($x),'--y',[string][Math]::Round($y),'--kind',$kind,'--clicks',[string]$Clicks)
  if($Held){$mouseArgs+='--held'}
  & bun @mouseArgs *> ($out+'/last-mouse.json')
  if($LASTEXITCODE -ne 0){throw ('Native pointer event failed: '+$kind)}
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
  if(@($initial.fontFaces|Where-Object {$_.status -eq 'loaded'}).Count -lt 8){throw 'Bundled editor fonts did not all load'}
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
  # Exercise GPUI hit-testing and native capture, not synthetic JS dispatch.
  Eval-Probe 'JSON.stringify((__nativeEditorProbe.brush("pen"),true))'|Out-Null
  Start-Sleep -Milliseconds 200
  $surface=Eval-Probe 'JSON.stringify(__nativeEditorProbe.surfaceGeometry())'
  $x=$surface.x+$surface.width*.5;$y=$surface.y+$surface.height*.5
  Mouse $x $y 'down'
  Mouse ($x+35) ($y+20) 'move' -Held
  Mouse ($surface.x+$surface.width+30) ($y+25) 'move' -Held
  Mouse ($surface.x+$surface.width+30) ($y+25) 'up'
  Start-Sleep -Milliseconds 250
  if((State).annotations -ne 1 -or (State).gesture){throw 'Native brush capture/release failed'}
  Mouse $x $y 'move'
  if((State).annotations -ne 1){throw 'Brush remained attached after release outside'}
  $brush=Snapshot '10-native-brush'
  foreach($brushKind in @('neon','blur')) {
    Eval-Probe ('JSON.stringify((__nativeEditorProbe.brush("'+$brushKind+'"),true))')|Out-Null
    Start-Sleep -Milliseconds 100
    Mouse ($x-25) ($y-30) 'down'
    Mouse ($x+25) ($y-30) 'move' -Held
    Mouse ($x+25) ($y-30) 'up'
    Start-Sleep -Milliseconds 250
    Snapshot ('11-'+$brushKind)|Out-Null
  }
  Eval-Probe 'JSON.stringify((__nativeEditorProbe.addText(),true))'|Out-Null
  Start-Sleep -Milliseconds 300
  Eval-Probe 'JSON.stringify((__nativeEditorProbe.tab("brush"),true))'|Out-Null
  Start-Sleep -Milliseconds 200
  $annotated=Snapshot '12-text'
  if($annotated.hash -eq $brush.hash){throw 'Text/effect annotations did not reach native GPU preview'}
  $annotationsBefore=Eval-Probe 'JSON.stringify(__nativeEditorProbe.annotationState())'
  Eval-Probe 'JSON.stringify((__nativeEditorProbe.perspective(),__nativeEditorProbe.diagnostics(),true))'|Out-Null
  Start-Sleep -Milliseconds 300
  $projected=Snapshot '13-perspective-gizmos'
  $annotationsAfter=Eval-Probe 'JSON.stringify(__nativeEditorProbe.annotationState())'
  if($projected.hash -eq $annotated.hash -or $annotationsBefore.lines -ne $annotationsAfter.lines -or $annotationsBefore.layers -ne $annotationsAfter.layers){throw 'Perspective did not reproject stable source annotations'}
  Eval-Probe 'JSON.stringify((__nativeEditorProbe.tab("text"),true))'|Out-Null
  Start-Sleep -Milliseconds 150
  $layer=Eval-Probe 'JSON.stringify(__nativeEditorProbe.layerGeometry())'
  Mouse $layer.x $layer.y 'down'
  Mouse ($layer.x+12) ($layer.y+8) 'move' -Held
  Mouse ($layer.x+12) ($layer.y+8) 'up'
  if((State).selected -ne 101 -or (State).gesture){throw 'Projected native text selection/drag failed'}
  Mouse ($layer.x+12) ($layer.y+8) 'click' -Clicks 2
  Start-Sleep -Milliseconds 150
  if((State).editing -ne 101){throw 'Native text double-click did not enter editing'}
  & bun $ctl --dist ($out+'/dist') type 'textarea' ' Edited' *> ($out+'/text-input.json')
  if($LASTEXITCODE -ne 0 -or (State).text -ne ' Edited'){throw 'Native text input did not update the layer'}
  Capture '14-text-editing'
  Eval-Probe 'JSON.stringify((__nativeEditorProbe.tab("crop"),true))'|Out-Null
  Start-Sleep -Milliseconds 200
  Export 'annotated'|Out-Null
  Eval-Probe 'JSON.stringify((__nativeEditorProbe.performance(),true))'|Out-Null
  $deadline=[DateTime]::UtcNow.AddSeconds(40)
  do {
    $perf=(State).performance
    if([DateTime]::UtcNow -gt $deadline){throw 'Interactive frame probe timed out'}
    if($perf.state -ne 'done'){Start-Sleep -Milliseconds 200}
  }until($perf.state -eq 'done')
  $perf|ConvertTo-Json|Set-Content -LiteralPath ($out+'/interactive-performance.json') -Encoding utf8
  if($perf.max -gt 500){throw ('Interactive rendering stalled for '+$perf.max+' ms')}
  Close-Editor 'reopened'
  Eval-Probe 'JSON.stringify((__nativeEditorProbe.open("sticker",true),true))'|Out-Null
  Wait-Ready|Out-Null
  Eval-Probe 'JSON.stringify((__nativeEditorProbe.brush("neon"),true))'|Out-Null
  Start-Sleep -Milliseconds 150
  $surface=Eval-Probe 'JSON.stringify(__nativeEditorProbe.surfaceGeometry())'
  $x=$surface.x+$surface.width*.5;$y=$surface.y+$surface.height*.5
  Mouse ($x-80) ($y-60) 'down'
  Mouse ($x+80) ($y+60) 'move' -Held
  Mouse ($x+80) ($y+60) 'up'
  Eval-Probe 'JSON.stringify((__nativeEditorProbe.brush("blur"),true))'|Out-Null
  Mouse ($x-80) ($y+40) 'down'
  Mouse ($x+80) ($y-40) 'move' -Held
  Mouse ($x+80) ($y-40) 'up'
  Eval-Probe 'JSON.stringify((__nativeEditorProbe.addText(),true))'|Out-Null
  Start-Sleep -Milliseconds 200
  Eval-Probe 'JSON.stringify((__nativeEditorProbe.tab("crop"),__nativeEditorProbe.performance(),true))'|Out-Null
  $deadline=[DateTime]::UtcNow.AddSeconds(60)
  do {
    $perf=(State).performance
    if([DateTime]::UtcNow -gt $deadline){throw 'Large image interactive frame probe timed out'}
    if($perf.state -ne 'done'){Start-Sleep -Milliseconds 200}
  }until($perf.state -eq 'done')
  $perf|ConvertTo-Json|Set-Content -LiteralPath ($out+'/large-interactive-performance.json') -Encoding utf8
  Capture '15-large-annotated'
  if($perf.max -gt 500){throw ('Large image interactive rendering stalled for '+$perf.max+' ms')}
  foreach($brushKind in @('pen','blur','neon','maskErase')) {
    Eval-Probe ('JSON.stringify((__nativeEditorProbe.brushPerformance("'+$brushKind+'"),true))')|Out-Null
    $deadline=[DateTime]::UtcNow.AddSeconds(60)
    do {
      $perf=(State).performance
      if([DateTime]::UtcNow -gt $deadline){throw ('Large brush probe timed out: '+$brushKind)}
      if($perf.state -ne 'done'){Start-Sleep -Milliseconds 200}
    }until($perf.state -eq 'done')
    $perf|ConvertTo-Json|Set-Content -LiteralPath ($out+'/large-brush-'+$brushKind+'-performance.json') -Encoding utf8
    if($perf.historyAfter -ne $perf.historyBefore+1){throw ($brushKind+' performance probe did not commit an actual gesture')}
    if($perf.max -gt 500){throw ($brushKind+' brush stalled for '+$perf.max+' ms')}
  }
  Close-Editor 'large'

  $runtimeLog=Get-Content -LiteralPath ($out+'/stderr.log') -Raw
  if($runtimeLog -match '\[js uncaught\]|\[dev\] boot: Error|bundled font .* did not load'){throw 'Native runtime logged an uncaught error or failed font load; see stderr.log'}
  $memRaw=& bun $ctl --dist ($out+'/dist') --timeout 20000 --json mem
  if($LASTEXITCODE -ne 0){throw 'GPU presentation counters unavailable'}
  $mem=($memRaw -join [Environment]::NewLine)|ConvertFrom-Json
  $mem|ConvertTo-Json -Depth 35|Set-Content -LiteralPath ($out+'/memory.json') -Encoding utf8
  $presentation=$mem.data.webgpuPresentation
  if(-not $presentation){throw 'Missing WebGPU presentation counters'}
  if($SharedDevice -and -not $Readback){
    if($presentation.nativeDisplayFrames -le 0 -or $presentation.atlasGpuCopies -le 0 -or $presentation.readbackDisplayFrames -ne 0 -or $presentation.atlasCpuFallbacks -ne 0){throw 'Native display unexpectedly used CPU readback or failed to import'}
  }elseif($presentation.readbackDisplayFrames -le 0){throw 'Readback baseline did not present frames'}
  [ordered]@{ok=$true;sharedDevice=[bool]$SharedDevice;gpuOnly=([bool]$SharedDevice -and -not [bool]$Readback);presentation=$presentation;pid=$child.Id;shader=$true;slider=$true;undo=$true;crop=$true;mask=$true;outline=$true;reopen=$true;nativeBrushCapture=$true;textEditing=$true;fonts=$true;projectedAnnotations=$true;largeImage=$true;avatar=@{width=$avatar.export.width;height=$avatar.export.height};sticker=@{width=$expression.export.width;height=$expression.export.height};output=$out}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath ($out+'/result.json') -Encoding utf8
  Get-Content -LiteralPath ($out+'/result.json')
} finally {
  if($child){
    $child.Refresh()
    if(-not $child.HasExited){Stop-Process -Id $child.Id;$child.WaitForExit(10000)|Out-Null}
    [ordered]@{pid=$child.Id;terminated=$child.HasExited}|ConvertTo-Json|Set-Content -LiteralPath ($out+'/cleanup.json') -Encoding utf8
  }
}
