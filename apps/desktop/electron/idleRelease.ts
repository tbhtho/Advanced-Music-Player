/** Retire expensive hidden helpers after idle time, without interrupting in-flight work. */
export class IdleRelease {
  private active = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private release: () => void, private delayMs = 120_000) {}
  begin(): () => void {
    this.cancel();
    this.active++;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      if (--this.active === 0) {
        this.timer = setTimeout(() => { this.timer = undefined; this.release(); }, this.delayMs);
        this.timer.unref?.();
      }
    };
  }
  cancel(): void { clearTimeout(this.timer); this.timer = undefined; }
}
