param([int]$Samples=6,[int]$IntervalSeconds=5,[string]$OutputPath)
$ErrorActionPreference='Stop'
if($Samples -lt 1 -or $Samples -gt 120 -or $IntervalSeconds -lt 1 -or $IntervalSeconds -gt 60){throw 'Invalid sampling bounds.'}
$projectRoot=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
if(-not $OutputPath){$OutputPath=Join-Path $projectRoot ('artifacts\memory-glass\process-accounting-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')+'.json')}
$snapshots=@()
$previous=@{}
$watch=[Diagnostics.Stopwatch]::StartNew()
$previousAt=$null
$logicalProcessors=[Environment]::ProcessorCount
for($sample=0;$sample -lt $Samples;$sample++){
  $all=Get-CimInstance Win32_Process
  $roots=@($all | Where-Object {
    ($_.Name -ieq 'AMP.exe' -or $_.Name -ieq 'MuSync.exe' -or ($_.Name -ieq 'electron.exe' -and $_.CommandLine -match '(?i)MuSync|AMP-development|amp-spotify-patch')) -and $_.CommandLine -notmatch '--type='
  })
  $now=$watch.Elapsed.TotalSeconds
  $seconds=if($null -ne $previousAt){$now-$previousAt}else{$null}
  $current=@{}
  $groups=foreach($root in $roots){
    $ids=@([int]$root.ProcessId)
    do {$next=@($all | Where-Object {$_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids} | Select-Object -ExpandProperty ProcessId);$ids+=$next}while($next.Count)
    $rows=foreach($entry in ($all | Where-Object {$_.ProcessId -in $ids})){
      $process=Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
      if(-not $process){continue}
      $role=if($entry.ProcessId -eq $root.ProcessId){'Main app'}elseif($entry.CommandLine -match '--utility-sub-type=([^\s"]+)'){'Utility: '+$Matches[1]}elseif($entry.CommandLine -match '--type=([^\s"]+)'){$Matches[1]}else{'Helper'}
      $cpu=[double]$process.CPU
      $percent=$null
      if($seconds -gt 0 -and $previous.ContainsKey([int]$entry.ProcessId) -and $cpu -ge $previous[[int]$entry.ProcessId]){
        $percent=100*($cpu-$previous[[int]$entry.ProcessId])/$seconds/$logicalProcessors
      }
      $current[[int]$entry.ProcessId]=$cpu
      [pscustomobject]@{pid=$entry.ProcessId;parentPid=$entry.ParentProcessId;role=$role;cpuPercentMachine=$percent;cpuSeconds=$cpu;workingSetBytes=$process.WorkingSet64;privateCommittedBytes=$process.PrivateMemorySize64}
    }
    $totalCpu=if(@($rows|Where-Object {$null -ne $_.cpuPercentMachine}).Count){($rows.cpuPercentMachine|Measure-Object -Sum).Sum}else{$null}
    [pscustomobject]@{rootPid=$root.ProcessId;executable=$root.ExecutablePath;processCount=@($rows).Count;cpuPercentMachine=$totalCpu;summedWorkingSetBytes=($rows.workingSetBytes|Measure-Object -Sum).Sum;privateCommittedBytes=($rows.privateCommittedBytes|Measure-Object -Sum).Sum;processes=@($rows)}
  }
  $snapshots+=[pscustomobject]@{utc=[DateTime]::UtcNow.ToString('o');intervalSeconds=$seconds;appInstanceCount=$roots.Count;groups=@($groups)}
  $previous=$current
  $previousAt=$now
  if($sample -lt ($Samples-1)){Start-Sleep -Seconds $IntervalSeconds}
}
$directory=Split-Path -Parent $OutputPath
[void][System.IO.Directory]::CreateDirectory($directory)
[pscustomobject]@{logicalProcessors=$logicalProcessors;snapshots=$snapshots;notes=@('Read-only process accounting. No apps were started, stopped, focused or changed.','CPU is process CPU-time delta divided by wall time and logical processor count. The first sample and new processes have no CPU percentage.','Summed working sets repeat shared pages; private committed bytes are not physical RAM.','Task Manager entries are processes. Each main root is one app instance; isolated development profiles can coexist with the installed app. No credentials or full command lines are recorded.')} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding utf8
Write-Output $OutputPath
