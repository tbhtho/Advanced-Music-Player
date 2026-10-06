import type { BrowserWindow } from "electron";
import { applyWindowsAcrylic } from "./windowsAcrylic.js";

export type WindowMaterial = "opaque" | "acrylic" | "vibrancy";
export function selectWindowMaterial(platform: string, release: string, highContrast: boolean, reducedTransparency: boolean): WindowMaterial {
  if (highContrast || reducedTransparency) return "opaque";
  if (platform === "darwin") return "vibrancy";
  const [major, , build] = release.split(".").map(Number);
  return platform === "win32" && major >= 10 && build >= 22621 ? "acrylic" : "opaque";
}
const applied = new WeakMap<BrowserWindow, WindowMaterial>();
const attempted = new WeakMap<BrowserWindow, WindowMaterial>();
const pending = new WeakMap<BrowserWindow, Promise<WindowMaterial>>();

/** Serialize actual material changes and leave the settled OS compositor alone. */
export async function applyWindowMaterial(window: BrowserWindow, material: WindowMaterial,
  windowsAcrylic: typeof applyWindowsAcrylic = applyWindowsAcrylic): Promise<WindowMaterial> {
  const previous = pending.get(window) ?? Promise.resolve("opaque" as WindowMaterial);
  const operation = previous.then(async (): Promise<WindowMaterial> => {
    if (attempted.get(window) === material || window.isDestroyed()) return applied.get(window) ?? "opaque";
    attempted.set(window, material);
    try {
      if (process.platform === "win32") {
        window.setBackgroundMaterial("none");
        if (material === "acrylic") {
          if (!await windowsAcrylic(window, true)) throw new Error("Native acrylic unavailable");
        } else if (applied.get(window) === "acrylic") {
          await windowsAcrylic(window, false);
        }
      }
      if (window.isDestroyed()) return "opaque";
      if (process.platform === "darwin") window.setVibrancy(material === "vibrancy" ? "under-window" : null);
      window.setBackgroundColor(material === "opaque" ? "#171719" : "#00000000");
      applied.set(window, material);
      return material;
    } catch {
      if (!window.isDestroyed()) window.setBackgroundColor("#171719");
      applied.set(window, "opaque");
      return "opaque";
    }
  });
  pending.set(window, operation);
  try { return await operation; } finally { if (pending.get(window) === operation) pending.delete(window); }
}
