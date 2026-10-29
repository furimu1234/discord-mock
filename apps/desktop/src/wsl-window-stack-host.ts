/** WSLgのプロキシウィンドウを、Windows公開APIでフォーカスを変えずに並べる。 */
export const windowStackHostScript = String.raw`
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class DisMockWindowStack {
  private delegate bool EnumProc(IntPtr window, IntPtr argument);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr argument);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder title, int length);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr window, int index);
  [DllImport("user32.dll", SetLastError=true)] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  private static bool Matches(IntPtr window, string[] titles, string distro) {
    var value = new StringBuilder(1024);
    GetWindowText(window, value, value.Capacity);
    foreach (var title in titles) {
      if (value.ToString() == title || value.ToString() == title + " (" + distro + ")") return true;
    }
    return false;
  }
  private static IntPtr NextVisible(IntPtr window) {
    var next = GetWindow(window, 2);
    for (int count = 0; next != IntPtr.Zero && count < 4096; count++, next = GetWindow(next, 2)) {
      if (IsWindowVisible(next)) return next;
    }
    return IntPtr.Zero;
  }
  public static string PlaceBehind(string[] activeTitles, string[] peerTitles, string distro) {
    var active = new List<IntPtr>();
    var peer = new List<IntPtr>();
    EnumWindows((window, argument) => {
      if (Matches(window, activeTitles, distro)) active.Add(window);
      if (Matches(window, peerTitles, distro)) peer.Add(window);
      return true;
    }, IntPtr.Zero);
    // 同名の別インスタンスがある場合は、対象を推測して操作しない。
    if (active.Count != 1 || peer.Count != 1 || active[0] == peer[0]) return "skipped";
    var a = active[0]; var b = peer[0];
    uint activeProcess, peerProcess;
    GetWindowThreadProcessId(a, out activeProcess);
    GetWindowThreadProcessId(b, out peerProcess);
    if (activeProcess == 0 || activeProcess != peerProcess) return "skipped";
    // 外部ツールで設定された最前面レベルも変えない。
    if ((GetWindowLong(a, -20) & 8) != (GetWindowLong(b, -20) & 8)) return "skipped";
    int stable = 0;
    // WSLgはアクティブ化の直後にも古い順序を再適用する。短時間だけ確定を確認する。
    for (int attempt = 0; attempt < 8; attempt++) {
      // 待機中のユーザー操作を優先し、他アプリへの切替・非表示・最小化で即終了。
      if (!Matches(a, activeTitles, distro) || !Matches(b, peerTitles, distro) || GetForegroundWindow() != a) return "skipped";
      if (!IsWindowVisible(a) || !IsWindowVisible(b) || IsIconic(a) || IsIconic(b)) return "skipped";
      if (NextVisible(a) != b) {
        // NOMOVE | NOSIZE | NOACTIVATE | NOOWNERZORDER。SHOWWINDOWやTOPMOSTは使わない。
        if (!SetWindowPos(b, a, 0, 0, 0, 0, 0x213)) return "error";
        stable = 0;
      } else stable++;
      if (attempt >= 4 && stable >= 2) return "placed";
      System.Threading.Thread.Sleep(25);
    }
    return GetForegroundWindow() == a && NextVisible(a) == b ? "placed" : "skipped";
  }
}
'@
[Console]::WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::ReadLine())) {
  $request = $null
  try {
    if ($line.Length -gt 8192) { throw "Invalid request" }
    $request = ConvertFrom-Json -InputObject $line
    if ($request.id -isnot [long] -and $request.id -isnot [int]) { throw "Invalid id" }
    if ($request.id -le 0) { throw "Invalid id" }
    foreach ($field in @("activeTitles", "peerTitles")) {
      $values = @($request.$field)
      if ($values.Count -eq 0 -or $values.Count -gt 8) { throw "Invalid titles" }
      foreach ($value in $values) {
        if ($value -isnot [string] -or $value.Length -eq 0 -or $value.Length -gt 512 -or $value -match '[\x00-\x1f\x7f]') { throw "Invalid text" }
      }
    }
    if ($request.distro -isnot [string] -or $request.distro.Length -eq 0 -or $request.distro.Length -gt 512 -or $request.distro -match '[\x00-\x1f\x7f]') { throw "Invalid distro" }
    $status = [DisMockWindowStack]::PlaceBehind([string[]]$request.activeTitles, [string[]]$request.peerTitles, $request.distro)
    [Console]::WriteLine((ConvertTo-Json -Compress -InputObject @{id=$request.id;status=$status}))
  } catch {
    [Console]::WriteLine((ConvertTo-Json -Compress -InputObject @{id=$request.id;status="error"}))
  }
}
`;
