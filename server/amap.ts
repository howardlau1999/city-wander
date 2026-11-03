import type { Coordinate, Place } from '../shared/types.js';

export class ApiError extends Error {
  constructor(message: string, public statusCode = 502) { super(message); }
}

export type JsonObject = Record<string, unknown>;
export const object = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
export const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const string = (value: unknown): string => typeof value === 'string' ? value : '';

export function coordinate(value: unknown): Coordinate | null {
  if (typeof value !== 'string') return null;
  const parts = value.split(',');
  if (parts.length !== 2 || parts.some((part) => part.trim() === '')) return null;
  const [lng, lat] = parts.map(Number);
  return Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90 ? [lng, lat] : null;
}

export const locationString = (location: Coordinate) => location.map((value) => value.toFixed(6)).join(',');

export function parsePlaces(data: unknown): Place[] {
  return array(object(data).pois).flatMap((item) => {
    const poi = object(item);
    // An entrance is preferable to a park's geometric centre when one is supplied.
    const location = coordinate(poi.entr_location) ?? coordinate(poi.location);
    const id = string(poi.id);
    const name = string(poi.name);
    return location && id && name ? [{ id, name, location, address: string(poi.address) }] : [];
  });
}

export type AmapRequest = (path: string, params: Record<string, string | number>, options?: { deadline?: number }) => Promise<JsonObject>;

export class RequestGate {
  private tail: Promise<void> = Promise.resolve();
  private lastStartedAt = -Infinity;
  private pending = 0;
  constructor(private intervalMs = 375, private maxPending = 30) {}

  async waitForSlot(deadline?: number): Promise<void> {
    if (this.pending >= this.maxPending) throw new ApiError('当前规划请求较多，请稍后重试。', 429);
    this.pending++;
    let expired = false;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const slot = this.tail.then(async () => {
      if (expired) return;
      const delay = Math.max(0, this.intervalMs - (Date.now() - this.lastStartedAt));
      if (deadline !== undefined && Date.now() + delay >= deadline) throw new ApiError('本次路线规划已超时，请稍后换一批重试。', 504);
      if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
      if (expired) return;
      this.lastStartedAt = Date.now();
    });
    this.tail = slot.catch(() => {});
    const expiry = deadline === undefined ? undefined : new Promise<void>((_resolve, reject) => {
      deadlineTimer = setTimeout(() => { expired = true; reject(new ApiError('本次路线规划已超时，请稍后换一批重试。', 504)); }, Math.max(0, deadline - Date.now()));
    });
    try { await (expiry ? Promise.race([slot, expiry]) : slot); }
    finally { clearTimeout(deadlineTimer); this.pending--; }
  }
}

// Shared by every client in this process: personal Keys currently allow 3 QPS.
// A slot controls the start time only, so slow responses don't block other starts.
const requestGate = new RequestGate();

export function createAmapClient(key: string, fetcher: typeof fetch = fetch, gate: RequestGate = requestGate): AmapRequest {
  return async (path, params, options) => {
    if (!key.trim()) throw new ApiError('尚未配置高德 Web 服务 Key，请在 .env 中填写 AMAP_WEB_KEY。', 503);
    await gate.waitForSlot(options?.deadline);
    const url = new URL(path, 'https://restapi.amap.com');
    Object.entries({ ...params, key, output: 'json' }).forEach(([name, value]) => url.searchParams.set(name, String(value)));
    let data: JsonObject;
    try {
      const remaining = options?.deadline === undefined ? 8_000 : options.deadline - Date.now();
      if (remaining <= 0) throw new ApiError('本次路线规划已超时，请稍后换一批重试。', 504);
      const response = await fetcher(url, { signal: AbortSignal.timeout(Math.min(8_000, remaining)) });
      if (!response.ok) throw new ApiError(`高德服务暂时不可用（HTTP ${response.status}），请稍后重试。`);
      data = object(await response.json());
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (options?.deadline !== undefined && Date.now() >= options.deadline) throw new ApiError('本次路线规划已超时，请稍后换一批重试。', 504);
      // Never expose a raw fetch exception, URL, API key or upstream body.
      throw new ApiError('高德服务连接失败或请求超时，请检查网络后重试。');
    }
    if (data.status !== '1') {
      const code = /^\d{5}$/.test(string(data.infocode)) ? string(data.infocode) : '未知';
      const hint = ['10001', '10002', '10007', '10009', '10012', '10013'].includes(code)
        ? '请检查 Web 服务 Key、权限与服务端 IP 白名单。'
        : ['10003', '10004', '10019', '10020', '10021'].includes(code)
          ? '调用配额或频率受限，请稍后重试或检查控制台配额。'
          : '请调整起点、时长或偏好后重试。';
      throw new ApiError(`高德请求未成功（${code}）。${hint}`);
    }
    return data;
  };
}
