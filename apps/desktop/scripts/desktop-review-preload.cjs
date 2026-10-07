const { contextBridge, ipcRenderer } = require("electron");
const invoke = (method, ...args) => ipcRenderer.invoke("amp-fixture", method, ...args);
contextBridge.exposeInMainWorld("spotCloud", {
  windowMaterial: { initial: "opaque", get: () => invoke("material"), onChanged: () => () => {} },
  runtime: { getInfo: () => invoke("runtime"), reload: () => invoke("runtime") },
  config: { get: () => invoke("config") },
  sessions: { list: async () => [], refresh: (request) => invoke("refresh", request), clear: async () => {} },
  gateway: { request: (request) => invoke("gateway", request) },
  soundcloud: { webReload: async () => ({ ok: false, source: "fixture" }), getPublicClientId: async () => "fixture-client" },
  windowControls: {
    onVisibilityChanged:(callback)=>{const listener=(_event,visible)=>callback(visible);ipcRenderer.on("amp-fixture-visibility",listener);return ()=>ipcRenderer.removeListener("amp-fixture-visibility",listener);},
    minimize:()=>invoke("windowMinimize"), toggleMaximize:()=>invoke("windowMaximize"), close:()=>invoke("windowClose"), setCompactMode:()=>invoke("windowCompact"), getState: () => invoke("windowState"), finishStartup: () => invoke("finishStartup") },
  artwork: { resolve: async () => ({ source: "none" }) },
  localMusic: { listFolders: async () => [], scan: async () => ({ ok: true, tracks: [] }) },
  discord: { setEnabled: async () => ({ ok: true }), setPresence: async () => ({ ok: true }) },
  media: { onMediaKey: () => () => {} }
});
