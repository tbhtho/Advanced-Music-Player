import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/index.css";

const rootElement = document.getElementById("root");
const materialBridge = window.spotCloud?.windowMaterial;
const setMaterial = (material: string) => {
  document.documentElement.dataset.material = material === "acrylic" || material === "vibrancy" ? "glass" : "opaque";
};
setMaterial(materialBridge?.initial ?? "opaque");
materialBridge?.onChanged(setMaterial);
void materialBridge?.get().then(setMaterial).catch(() => setMaterial("opaque"));

if (!rootElement) {
  throw new Error("AMP could not find the root element.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
