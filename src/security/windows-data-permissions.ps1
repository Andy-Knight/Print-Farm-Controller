param(
  [string]$DataDir,
  [string]$LogDir,
  [string]$ApplicationDir,
  [string]$Account,
  [string]$OwnerRecord,
  [switch]$Repair
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Never load user-supplied modules or inherited PowerShell 7 modules in Windows PowerShell.
$env:PSModulePath = [IO.Path]::Combine($PSHOME,'Modules')
Set-StrictMode -Version Latest

function Assert-PlainPath([string]$Value) {
  $item = Get-Item -LiteralPath $Value -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Linked/reparse paths are not permitted for controller storage.'
  }
  if (-not $item.PSIsContainer -and $item.LinkType -eq 'HardLink') {
    throw 'Hard-linked files are not permitted in controller storage.'
  }
  return $item
}

function Assert-Ancestors([string]$Value) {
  $cursor = $Value
  while ($cursor) {
    if (Test-Path -LiteralPath $cursor) { $null = Assert-PlainPath $cursor }
    $parent = [IO.Path]::GetDirectoryName($cursor.TrimEnd('\'))
    if ($parent -eq $cursor) { break }
    $cursor = $parent
  }
}

function Resolve-Owner([string]$Value) {
  $sid = if ($Value -match '^S-1-') {
    New-Object Security.Principal.SecurityIdentifier($Value)
  } else {
    (New-Object Security.Principal.NTAccount($Value)).Translate([Security.Principal.SecurityIdentifier])
  }
  # LookupAccountSid distinguishes a user from a group even for domain SIDs.
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class PfcOwnerLookup {
  [StructLayout(LayoutKind.Sequential)] public struct Luid { public uint Low; public int High; }
  [StructLayout(LayoutKind.Sequential)] public struct Privileges { public uint Count; public Luid Id; public uint Attributes; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool LookupAccountSid(string system, byte[] sid,
    StringBuilder name, ref uint nameSize, StringBuilder domain, ref uint domainSize, out int use);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool LookupPrivilegeValue(string system, string name, out Luid id);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool AdjustTokenPrivileges(IntPtr token, bool disable, ref Privileges value, uint size, IntPtr previous, IntPtr returned);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static void EnableRestore() {
    IntPtr token;
    if (!OpenProcessToken(System.Diagnostics.Process.GetCurrentProcess().Handle, 0x28, out token)) throw new System.ComponentModel.Win32Exception();
    try {
      var value = new Privileges { Count=1, Attributes=2 };
      if (!LookupPrivilegeValue(null,"SeRestorePrivilege",out value.Id) ||
          !AdjustTokenPrivileges(token,false,ref value,0,IntPtr.Zero,IntPtr.Zero) || Marshal.GetLastWin32Error()!=0)
        throw new System.ComponentModel.Win32Exception();
    } finally { CloseHandle(token); }
  }
}
'@
  $bytes = New-Object byte[] $sid.BinaryLength
  $sid.GetBinaryForm($bytes,0)
  [uint32]$nameSize=0; [uint32]$domainSize=0; [int]$use=0
  $null=[PfcOwnerLookup]::LookupAccountSid($null,$bytes,$null,[ref]$nameSize,$null,[ref]$domainSize,[ref]$use)
  $name=New-Object Text.StringBuilder ([int]$nameSize)
  $domain=New-Object Text.StringBuilder ([int]$domainSize)
  if (-not [PfcOwnerLookup]::LookupAccountSid($null,$bytes,$name,[ref]$nameSize,$domain,[ref]$domainSize,[ref]$use) -or
      ($use -ne 1 -and $sid.Value -ne 'S-1-5-18')) {
    throw 'Controller account must resolve to an individual Windows user or LocalSystem, not a group.'
  }
  [PfcOwnerLookup]::EnableRestore()
  return $sid
}

function Set-PrivateAcl($Item, $Owner) {
  $Item = Assert-PlainPath $Item.FullName
  $acl = if ($Item.PSIsContainer) {
    New-Object Security.AccessControl.DirectorySecurity
  } else {
    New-Object Security.AccessControl.FileSecurity
  }
  $acl.SetAccessRuleProtection($true,$false)
  if ($Item.GetAccessControl().GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $Owner.Value) {
    $existingOwner=$Item.GetAccessControl().GetOwner([Security.Principal.SecurityIdentifier]).Value
    # Elevated Windows processes commonly create files owned by Administrators.
    # That is the current administrator's default owner, not a different user.
    if (-not $Repair -and -not ($administrator -and $existingOwner -eq 'S-1-5-32-544')) {
      throw 'Storage has a different Windows owner; run elevated installer/permission repair.'
    }
    $acl.SetOwner($Owner)
  }
  $inheritance = if ($Item.PSIsContainer) { 'ContainerInherit,ObjectInherit' } else { 'None' }
  foreach ($value in @($Owner.Value,'S-1-5-18','S-1-5-32-544') | Select-Object -Unique) {
    $sid=New-Object Security.Principal.SecurityIdentifier($value)
    $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl',$inheritance,'None','Allow')
    $null=$acl.AddAccessRule($rule)
  }
  # Persist only owner/DACL changes; do not request SACL/audit privileges.
  $Item.SetAccessControl($acl)
  $verified=$Item.GetAccessControl()
  $rules=@($verified.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  $allowed=@($Owner.Value,'S-1-5-18','S-1-5-32-544') | Select-Object -Unique
  if (-not $verified.AreAccessRulesProtected -or
      $verified.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $Owner.Value -or
      $rules.Count -ne $allowed.Count) { throw 'Controller storage ACL verification failed.' }
  foreach ($rule in $rules) {
    if ($rule.IdentityReference.Value -notin $allowed -or $rule.AccessControlType -ne 'Allow' -or
        ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne [Security.AccessControl.FileSystemRights]::FullControl) {
      throw 'Controller storage ACL verification failed.'
    }
  }
}

try {
  if (-not $DataDir) {
    $request=[Console]::In.ReadToEnd() | ConvertFrom-Json
    $DataDir=$request.dataDir; $LogDir=$request.logDir
    $ApplicationDir=$request.applicationDir; $OwnerRecord=$request.ownerRecord
  }
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  $administrator=(New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($Account) {
    if (-not $Repair -or -not $administrator) { throw 'Changing the controller owner requires elevated explicit repair.' }
    $owner=Resolve-Owner $Account
  } elseif ($OwnerRecord -and (Test-Path -LiteralPath $OwnerRecord)) {
    Assert-Ancestors $OwnerRecord
    $owner=New-Object Security.Principal.SecurityIdentifier((Get-Content -LiteralPath $OwnerRecord -Raw).Trim())
  } else { $owner=$identity.User }
  if (-not $Repair -and $identity.User.Value -ne $owner.Value) {
    throw 'Start the controller as its owning Windows account. Use the installer to change ownership.'
  }
  $application=[IO.Path]::GetFullPath($ApplicationDir).TrimEnd('\')
  $roots=@($DataDir,$LogDir) | Where-Object { $_ } | ForEach-Object {
    if (-not [IO.Path]::IsPathRooted($_) -or $_.StartsWith('\\')) {
      throw 'Windows controller storage requires a dedicated local ACL-capable directory.'
    }
    $root=[IO.Path]::GetFullPath($_).TrimEnd('\')
    $forbidden=@([IO.Path]::GetPathRoot($root).TrimEnd('\'),$env:SystemRoot,$env:USERPROFILE,$env:ProgramFiles,${env:ProgramFiles(x86)})
    if ($root -in $forbidden -or $application -eq $root -or $application.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) {
      throw 'Controller storage cannot be a drive, profile, system or application root/ancestor.'
    }
    Assert-Ancestors $root
    $root
  } | Select-Object -Unique
  # Inspect every existing entry before changing ACLs; do not follow junctions.
  $entries=New-Object 'Collections.Generic.List[object]'
  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { $null=[IO.Directory]::CreateDirectory($root) }
    if (-not (Assert-PlainPath $root).PSIsContainer) { throw 'Controller storage must be a directory.' }
    $pending=New-Object 'Collections.Generic.Stack[string]'
    $pending.Push($root)
    while ($pending.Count) {
      $item=Assert-PlainPath $pending.Pop()
      $existingOwner=$item.GetAccessControl().GetOwner([Security.Principal.SecurityIdentifier]).Value
      if (-not $Repair -and $existingOwner -ne $owner.Value -and
          -not ($administrator -and $existingOwner -eq 'S-1-5-32-544')) {
        throw 'Storage has a different Windows owner; run elevated installer/permission repair.'
      }
      $entries.Add($item)
      if ($item.PSIsContainer) {
        foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force) {
          $null=Assert-PlainPath $child.FullName
          $pending.Push($child.FullName)
        }
      }
    }
  }
  foreach ($item in $entries) { Set-PrivateAcl $item $owner }
  if ($Repair -and $OwnerRecord) {
    Assert-Ancestors ([IO.Path]::GetDirectoryName($OwnerRecord))
    if (Test-Path -LiteralPath $OwnerRecord) { $null=Assert-PlainPath $OwnerRecord }
    [IO.File]::WriteAllText($OwnerRecord,$owner.Value,[Text.Encoding]::ASCII)
  }
  @{ ownerSid=$owner.Value; roots=@($roots) } | ConvertTo-Json -Compress
} catch {
  [Console]::Error.WriteLine('Windows controller storage protection failed: '+$_.Exception.Message)
  exit 1
}
