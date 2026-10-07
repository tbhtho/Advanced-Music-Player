import type { AppUpdateState } from "../src/lib/appUpdates.js";

export interface UpdateEngine {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}
export class AppUpdates {
  private state: AppUpdateState;
  private pendingCheck?: Promise<AppUpdateState>;
  private pendingDownload?: Promise<AppUpdateState>;
  private installing = false;
  private disposed = false;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private repeatTimer?: ReturnType<typeof setInterval>;
  private listeners: Array<[string, (...args: any[]) => void]> = [];
  constructor(
    private readonly engine: UpdateEngine | undefined,
    currentVersion: string,
    private readonly notify: (state: AppUpdateState) => void,
    private readonly confirmInstallation: () => Promise<boolean>
  ) {
    this.state = { phase: engine ? "idle" : "unsupported", currentVersion,
      message: engine ? "AMP checks for new releases automatically." : "Updates are available in the installed Windows app." };
    if (!engine) return;
    // Checking never downloads; closing AMP never installs without consent.
    engine.autoDownload = false;
    engine.autoInstallOnAppQuit = false;
    engine.allowPrerelease = false;
    engine.allowDowngrade = false;
    this.listen("update-available", (info: { version: string }) => {
      if (typeof info?.version !== "string" || !/^\d+\.\d+\.\d+(?:\+[\w.-]+)?$/.test(info.version)) {
        this.fail("Could not read this release. Please check again later."); return;
      }
      this.set({ phase: "available", availableVersion: info.version, percent: undefined,
        message: "AMP " + info.version + " is available. Download when you are ready.", lastCheckedAt: new Date().toISOString() });
    });
    this.listen("update-not-available", () => this.set({phase:"current", availableVersion:undefined,
      percent:undefined, message:"You are using the latest AMP release.", lastCheckedAt:new Date().toISOString()}));
    this.listen("download-progress", (progress: { percent: number }) => {
      if (this.state.phase === "downloading" && Number.isFinite(progress.percent)) this.set({percent:Math.max(0, Math.min(100, Math.round(progress.percent)))});
    });
    this.listen("update-downloaded", () => this.set({phase:"downloaded", percent:100,
      message:"Update downloaded. Restart and update when you are ready; playback will stop."}));
    this.listen("error", () => this.fail(this.pendingDownload ? "The update could not be downloaded. Check your connection and try again." : "Could not check for updates. Check your connection and try again."));
  }
  getState(): AppUpdateState { return {...this.state}; }
  private set(change: Partial<AppUpdateState>): void {
    if (this.disposed) return;
    this.state = {...this.state, ...change}; this.notify(this.getState());
  }
  private fail(message: string): void {this.set({phase:"error", percent:undefined, message});}
  private listen(event: string, callback: (...args: any[]) => void): void {
    this.engine!.on(event, callback); this.listeners.push([event, callback]);
  }
  start(): void {
    if (!this.engine || this.startupTimer || this.repeatTimer || this.disposed) return;
    this.startupTimer = setTimeout(() => {this.startupTimer=undefined; void this.check();}, 15000);
    this.repeatTimer = setInterval(() => void this.check(), 6 * 60 * 60 * 1000);
  }
  check(): Promise<AppUpdateState> {
    if (this.pendingCheck) return this.pendingCheck;
    if (!this.engine || this.disposed || this.pendingDownload || this.state.phase==="downloaded" || this.installing) return Promise.resolve(this.getState());
    this.set({phase:"checking",message:"Checking for a new AMP release..."});
    const task = Promise.resolve().then(() => this.engine!.checkForUpdates()).catch(() => this.fail("Could not check for updates. Check your connection and try again."))
      .then(() => this.getState()).finally(() => {this.pendingCheck=undefined;});
    this.pendingCheck=task; return task;
  }
  download(): Promise<AppUpdateState> {
    if (this.pendingDownload) return this.pendingDownload;
    if (!this.engine || this.disposed || this.pendingCheck || !this.state.availableVersion ||
      !["available","error"].includes(this.state.phase)) return Promise.resolve(this.getState());
    this.set({phase:"downloading",percent:0,message:"Downloading the AMP update. Playback can continue."});
    const task=Promise.resolve().then(() => this.engine!.downloadUpdate()).catch(() => this.fail("The update could not be downloaded. Check your connection and try again."))
      .then(() => this.getState()).finally(() => {this.pendingDownload=undefined;});
    this.pendingDownload=task; return task;
  }
  async install(): Promise<boolean> {
    if (!this.engine || this.disposed || this.state.phase!=="downloaded" || this.installing || this.pendingDownload) return false;
    this.installing=true;
    try {
      if (!await this.confirmInstallation() || this.disposed || this.state.phase!=="downloaded") return false;
      this.engine.quitAndInstall(false, true); return true;
    } catch {
      this.fail("Could not start the installer. Try again or download AMP from its release page."); return false;
    } finally {this.installing=false;}
  }
  dispose(): void {
    this.disposed=true; clearTimeout(this.startupTimer); clearInterval(this.repeatTimer);
    for (const [event, listener] of this.listeners) this.engine?.removeListener(event, listener);
    this.listeners=[];
  }
}
