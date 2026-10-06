import type { BrowserWindow } from "electron";
import { execFile } from "node:child_process";

// Same composition policy as BloxMesh's native Windows glass. Electron's system
// backdrop is opaque over transparent WebContents on this host; use one OS blur.
const nativePolicy = `using System; using System.Runtime.InteropServices;
public static class AmpWindowMaterial {
  [StructLayout(LayoutKind.Sequential)] public struct Policy { public int State, Flags, Color, Animation; }
  [StructLayout(LayoutKind.Sequential)] public struct Data { public int Attribute; public IntPtr Value, Size; }
  [DllImport("user32.dll")] public static extern bool SetWindowCompositionAttribute(IntPtr window, ref Data data);
  public static bool Apply(IntPtr window, int state) {
    var policy = new Policy { State = state, Color = 0x01000000 };
    var pointer = Marshal.AllocHGlobal(Marshal.SizeOf<Policy>());
    try {
      Marshal.StructureToPtr(policy, pointer, false);
      var data = new Data { Attribute = 19, Value = pointer, Size = new IntPtr(Marshal.SizeOf<Policy>()) };
      return SetWindowCompositionAttribute(window, ref data);
    } finally { Marshal.FreeHGlobal(pointer); }
  }
}`;

/** A bounded hidden native call; no persistent helper or external dependency. */
export function applyWindowsAcrylic(window: BrowserWindow, enabled: boolean): Promise<boolean> {
  if (process.platform !== "win32" || window.isDestroyed()) return Promise.resolve(false);
  const handle = window.getNativeWindowHandle().readBigUInt64LE().toString();
  const script = `Add-Type -TypeDefinition '${nativePolicy.replaceAll("'", "''")}'; [Console]::Write([AmpWindowMaterial]::Apply([IntPtr]::new(${handle}), ${enabled ? 4 : 0}))`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return new Promise(resolve => {
    execFile("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoded],
      { windowsHide: true, timeout: 8000, maxBuffer: 1024 }, (error, stdout) => resolve(!error && stdout.trim() === "True"));
  });
}
