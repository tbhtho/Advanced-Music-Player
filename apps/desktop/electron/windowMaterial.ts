import type { BrowserWindow } from "electron";

export type WindowMaterial = "opaque" | "acrylic" | "vibrancy";

export function selectWindowMaterial(platform: string, release: string, highContrast: boolean, reducedTransparency: boolean): WindowMaterial {
  if (highContrast || reducedTransparency) return "opaque";
  if (platform === "darwin") return "vibrancy";
  const [major, , build] = release.split(".").map(Number);
  return platform === "win32" && major >= 10 && build >= 22621 ? "acrylic" : "opaque";
}

/** One OS-composited backdrop for the window; individual panels never allocate blur layers. */
export function applyWindowMaterial(window: BrowserWindow, material: WindowMaterial): WindowMaterial {
  try {
    if (process.platform === "win32") window.setBackgroundMaterial(material === "acrylic" ? "acrylic" : "none");
    if (process.platform === "darwin") window.setVibrancy(material === "vibrancy" ? "under-window" : null);
    window.setBackgroundColor(material === "opaque" ? "#101012" : "#00000000");
    return material;
  } catch {
    window.setBackgroundColor("#101012");
    return "opaque";
  }
}
