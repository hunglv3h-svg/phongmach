/**
 * Giới hạn tốc độ đăng nhập nội bộ (§4.6) — thay vai trò F5 của Medplum (5/phút/IP dùng chung sau NAT).
 * Đếm thất bại theo khóa (loginId hoặc IP); khóa mềm trong `windowMs` sau khi vượt `maxFailures`.
 * `now` tiêm được để kiểm thử bằng thời gian ảo (KHÔNG sleep).
 */
export class LoginRateLimiter {
  private readonly fails = new Map<string, { count: number; firstAt: number; lockedUntil: number }>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number
  ) {}

  /** true nếu khóa đang bị chặn (đã vượt ngưỡng và còn trong cửa sổ). */
  isLocked(key: string, now: number): boolean {
    const e = this.fails.get(key);
    if (!e) return false;
    if (now >= e.lockedUntil && now - e.firstAt >= this.windowMs) {
      this.fails.delete(key);
      return false;
    }
    return now < e.lockedUntil;
  }

  /** Ghi một lần thất bại; khi đạt ngưỡng thì đặt khóa mềm tới hết cửa sổ. */
  recordFailure(key: string, now: number): void {
    const e = this.fails.get(key);
    if (!e || now - e.firstAt >= this.windowMs) {
      this.fails.set(key, { count: 1, firstAt: now, lockedUntil: 0 });
      return;
    }
    e.count += 1;
    if (e.count >= this.maxFailures) e.lockedUntil = now + this.windowMs;
  }

  /** Đăng nhập thành công: xóa bộ đếm cho khóa. */
  recordSuccess(key: string): void {
    this.fails.delete(key);
  }
}
