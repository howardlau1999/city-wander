export type LocationIssueKind = 'insecure' | 'unsupported' | 'permission' | 'unavailable' | 'timeout' | 'unknown';

export interface LocationIssue {
  kind: LocationIssueKind;
  title: string;
  message: string;
}

const ISSUES: Record<LocationIssueKind, LocationIssue> = {
  insecure: {
    kind: 'insecure', title: '当前地址不支持自动定位',
    message: '当前页面不是安全连接，浏览器不会提供精确位置。可以直接在地图上选起点；手机自动定位需要使用可信的 HTTPS 地址。',
  },
  unsupported: {
    kind: 'unsupported', title: '当前浏览器不支持自动定位',
    message: '请用手机系统浏览器打开，或直接在地图上选起点。',
  },
  permission: {
    kind: 'permission', title: '定位权限被阻止',
    message: '请检查系统的位置服务、浏览器定位权限和这个网站的位置权限。开启后再试；也可以在地图上选起点。',
  },
  unavailable: {
    kind: 'unavailable', title: '暂时无法确定位置',
    message: '设备或浏览器的定位服务未返回位置，可能与信号或网络有关。可以重试，或在地图上选起点。',
  },
  timeout: {
    kind: 'timeout', title: '获取位置超时',
    message: '定位服务没有及时响应。可以移到信号更好的地方重试，或在地图上选起点。',
  },
  unknown: {
    kind: 'unknown', title: '暂时没有获取到位置',
    message: '请重试，或直接在地图上选起点。',
  },
};

export function locationAvailability(secureContext: boolean, supported: boolean): LocationIssue | null {
  // Insecure browsers sometimes omit geolocation altogether: report the actual cause first.
  if (!secureContext) return ISSUES.insecure;
  if (!supported) return ISSUES.unsupported;
  return null;
}

export function locationErrorIssue(error: unknown): LocationIssue {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  return code === 1 ? ISSUES.permission : code === 2 ? ISSUES.unavailable : code === 3 ? ISSUES.timeout : ISSUES.unknown;
}

/** A watchdog also covers browsers that never invoke either callback. */
export function getBrowserPosition(geolocation: Pick<Geolocation, 'getCurrentPosition'>, signal?: AbortSignal): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      action();
    };
    const abort = () => finish(() => reject(new DOMException('定位已取消', 'AbortError')));
    const timer = setTimeout(() => finish(() => reject({ code: 3 })), 16_000);
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    try {
      geolocation.getCurrentPosition(
        position => finish(() => resolve(position)),
        error => finish(() => reject(error)),
        { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
      );
    } catch (error) { finish(() => reject(error)); }
  });
}
