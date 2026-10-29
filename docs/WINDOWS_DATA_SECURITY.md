# Windows controller data ownership

The Windows controller uses one owning Windows account. Browser Administrator,
Operator and Viewer roles are independent of this filesystem identity. Data and
logs contain credentials, private keys and operational state and must not be
shared with every local Windows user.

The installer keeps program files under Program Files and asks which individual
Windows account will run the controller. Enter `MACHINE\user`, `DOMAIN\user` or
that user's SID. If UAC elevation used another administrator's credentials, select
the ordinary account that will launch the controller. SYSTEM and the local
Administrators group retain full access for Windows administration and recovery.
Groups such as Users cannot be selected as the owning account. The controller is
still an interactive application; this does not install a Windows service.

On upgrade the installer retains the SID in `controller-owner.sid` beside the
executable, including silent upgrades, unless a different account is explicitly
selected. It replaces existing data/log access rules, removes inherited and
explicit grants to other accounts, and repairs ownership of existing files.
Program Files protects the owner record from ordinary users' modification.

An unattended installation can select the owner explicitly:

```powershell
.\PrintFarmController-Setup-v0.61.9.exe /VERYSILENT /ControllerAccount="MACHINE\controlleruser"
```

Do not use the post-install launch option when the original desktop account
differs from the selected owner. Launch from the selected account instead.

## Source, portable and custom storage

On Windows, startup restricts the resolved data and log directories before reading
credentials or opening HTTP/HTTPS listeners. The CLI account store and HTTPS key
store also protect their data directory. New files inherit access for the owner,
SYSTEM and Administrators; atomic replacements retain that protection. Restore
activation triggers a new permission check before restored accounts are loaded.
An elevated owner's token can create files owned by the Administrators group;
their access rules still grant access only to the three trusted identities. The
next protection pass normalizes that Windows default owner to the chosen user.

Use dedicated local directories on an ACL-capable filesystem, with protected
parent directories. Drive roots, profile/system/application roots or their
ancestors, UNC shares, junctions, symbolic links and hard-linked files are rejected.
`DATA_DIR` and `LOG_DIR` remain separate and may be configured independently. The
controller does not change permissions on their parent directories. Existing
same-owner source/portable data can be hardened automatically. Data owned by
another Windows account requires explicit elevated repair; routine startup never
silently takes ownership from another account. Linux/container permissions are
unchanged.

## Upgrade and local repair

Stop the controller and take a protected backup before upgrading or changing the
Windows owner. The permission migration preserves file contents, account records,
licences and TLS identities. It cannot undo previous exposure or modification;
review existing state and rotate affected secrets if the host was shared with
untrusted users.

For installer-managed default storage, rerun the installer as Administrator and
select the intended account. For source, portable or custom storage, run the
matching permission helper from an elevated Windows PowerShell console, using
absolute paths to the actual dedicated directories:

```powershell
& 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
  -NoProfile -NonInteractive -ExecutionPolicy Bypass `
  -File 'C:\PFC\src\security\windows-data-permissions.ps1' `
  -Repair -ApplicationDir 'C:\PFC' `
  -DataDir 'C:\PFC\data' -LogDir 'C:\PFC\logs' `
  -Account 'MACHINE\controlleruser'
```

For an installed application the helper is beside the executable; add
`-OwnerRecord 'C:\Program Files\Print Farm Controller\controller-owner.sid'`
when deliberately changing its owner. Use the same chosen Windows account for
normal startup and local account recovery. Do not resolve a failed permission
check by granting Users/Everyone access or running the controller under a different
administrator account.

Failures leave startup closed and show a local repair error. Remove linked entries
deliberately after reviewing them; the helper never follows them to change an
outside target's permissions. Administrative policy restricting system Windows
PowerShell or ACL changes must be resolved by the host administrator. Custom
shared/NAS storage requires a separately reviewed storage identity and ACL policy;
it is not accepted as a Windows runtime data/log directory by this policy.

Validation checks real NTFS access rules, inheritance on newly created files,
atomic account updates, preserved migration contents, linked-path rejection and
explicit owner reassignment on an elevated Windows runner. Local administrators
and SYSTEM remain trusted host administrators; this does not isolate data from
them. See Microsoft's [filesystem access control documentation](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/set-acl?view=powershell-5.1)
and Inno Setup's [account context constants](https://jrsoftware.org/ishelp/topic_consts.htm).
