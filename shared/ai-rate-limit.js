export class RateLimiter {
  constructor(maxPerMinute = 15) {
    this.maxPerMinute = maxPerMinute;
    this.timestamps = [];
  }

  async acquire() {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < 60000);
    if (this.timestamps.length < this.maxPerMinute) {
      this.timestamps.push(now);
      return;
    }
    const oldest = this.timestamps[0];
    const waitMs = 60000 - (now - oldest) + 100;
    return new Promise((resolve) => {
      setTimeout(() => {
        this.timestamps.push(Date.now());
        resolve();
      }, waitMs);
    });
  }

  reset() {
    this.timestamps = [];
  }
}
