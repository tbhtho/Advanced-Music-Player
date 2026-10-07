export type AppUpdatePhase = "unsupported" | "idle" | "checking" | "current" | "available" | "downloading" | "downloaded" | "error";
export interface AppUpdateState {
  phase: AppUpdatePhase;
  currentVersion: string;
  availableVersion?: string;
  percent?: number;
  message: string;
  lastCheckedAt?: string;
}
