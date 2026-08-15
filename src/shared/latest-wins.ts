export interface VersionedValue<T> {
  revision: number;
  value: T;
}

interface Waiter {
  revision: number;
  resolve(): void;
  reject(error: unknown): void;
}

/**
 * Serialize asynchronous writes while collapsing queued work to the newest
 * snapshot. This prevents an older slow write from finishing after a newer one
 * and becoming the final persisted/runtime value.
 */
export class LatestWinsWriter<T> {
  private pending: VersionedValue<T> | null = null;
  private running = false;
  private committedRevision = -1;
  private latestAcceptedRevision = -1;
  private readonly waiters: Waiter[] = [];

  constructor(private readonly write: (entry: VersionedValue<T>) => Promise<void>) {}

  submit(entry: VersionedValue<T>): Promise<void> {
    if (!Number.isInteger(entry.revision) || entry.revision < 0) {
      return Promise.reject(new Error('Revision must be a non-negative integer.'));
    }
    if (entry.revision <= this.committedRevision || entry.revision <= this.latestAcceptedRevision) return Promise.resolve();
    this.latestAcceptedRevision = entry.revision;
    this.pending = entry;

    const result = new Promise<void>((resolve, reject) => {
      this.waiters.push({ revision: entry.revision, resolve, reject });
    });
    void this.pump();
    return result;
  }

  private settleThrough(revision: number): void {
    for (let i = this.waiters.length - 1; i >= 0; i -= 1) {
      const waiter = this.waiters[i];
      if (waiter.revision <= revision) {
        this.waiters.splice(i, 1);
        waiter.resolve();
      }
    }
  }

  private rejectThrough(revision: number, error: unknown): void {
    for (let i = this.waiters.length - 1; i >= 0; i -= 1) {
      const waiter = this.waiters[i];
      if (waiter.revision <= revision) {
        this.waiters.splice(i, 1);
        waiter.reject(error);
      }
    }
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending) {
        const current = this.pending;
        this.pending = null;
        try {
          await this.write(current);
          this.committedRevision = Math.max(this.committedRevision, current.revision);
          this.settleThrough(this.committedRevision);
        } catch (error) {
          this.rejectThrough(current.revision, error);
        }
      }
    } finally {
      this.running = false;
      if (this.pending) void this.pump();
    }
  }
}
