# Script to launch VALENCE on the interactive user desktop WinSta0\Default
param(
  [string]$ExePath = "C:\Users\ratin\Desktop\my-PROJECTS\Gong Alter\dist-desktop\win-unpacked\VALENCE.exe"
)

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32Launcher {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO {
        public Int32 cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public Int32 dwX;
        public Int32 dwY;
        public Int32 dwXSize;
        public Int32 dwYSize;
        public Int32 dwXCountChars;
        public Int32 dwYCountChars;
        public Int32 dwFillAttribute;
        public Int32 dwFlags;
        public Int16 wShowWindow;
        public Int16 cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public Int32 dwProcessId;
        public Int32 dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcess(
        string lpApplicationName,
        string lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        ref PROCESS_INFORMATION lpProcessInformation);
}
"@

$si = New-Object Win32Launcher+STARTUPINFO
$si.cb = [System.Runtime.InteropServices.Marshal]::SizeOf($si)
$si.lpDesktop = "WinSta0\Default"

$pi = New-Object Win32Launcher+PROCESS_INFORMATION

$workDir = [System.IO.Path]::GetDirectoryName($ExePath)
if ([string]::IsNullOrEmpty($workDir)) {
  $workDir = $env:SystemRoot
}
$cmdLine = "`"$ExePath`""

# CREATE_BREAKAWAY_FROM_JOB = 0x01000000
$flags = [uint32]0x01000000

$ok = [Win32Launcher]::CreateProcess($ExePath, $cmdLine, [IntPtr]::Zero, [IntPtr]::Zero, $false, $flags, [IntPtr]::Zero, $workDir, [ref]$si, [ref]$pi)
$err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()

if (!$ok) {
  # Try without breakaway
  $ok = [Win32Launcher]::CreateProcess($ExePath, $cmdLine, [IntPtr]::Zero, [IntPtr]::Zero, $false, 0, [IntPtr]::Zero, $workDir, [ref]$si, [ref]$pi)
  $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
}

Write-Output "Launch Result: Success=$ok, PID=$($pi.dwProcessId), LastError=$err"

if ($ok -and $pi.dwProcessId -gt 0) {
  Write-Output "Waiting for process $($pi.dwProcessId) to keep daemon alive on WinSta0\Default..."
  Wait-Process -Id $pi.dwProcessId
}
