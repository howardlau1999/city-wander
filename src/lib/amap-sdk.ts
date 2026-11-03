import type { AppConfig, Coordinate } from '../../shared/types';

export interface AMapLngLat { getLng: () => number; getLat: () => number }
export interface AMapEvent { lnglat?: AMapLngLat }
export interface MapOverlay { on: (event: string, callback: (event: AMapEvent) => void) => void }
export interface AMapMarker extends MapOverlay { setPosition: (position: Coordinate) => void }
export interface AMapInstance {
  add: (overlays: MapOverlay[]) => void;
  remove: (overlays: MapOverlay[]) => void;
  setFitView: (overlays?: MapOverlay[], immediately?: boolean, padding?: number[]) => void;
  setZoom: (zoom: number) => void;
  getZoom: () => number;
  setCenter: (position: Coordinate) => void;
  getCenter: () => AMapLngLat;
  destroy: () => void;
  on: (event: string, callback: (event: AMapEvent) => void) => void;
}
export interface AMapLocationResult {
  position?: AMapLngLat;
  accuracy?: number;
  location_type?: string;
  isConverted?: boolean;
}
export interface AMapNamespace {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => AMapInstance;
  Polyline: new (options: Record<string, unknown>) => MapOverlay;
  Marker: new (options: Record<string, unknown>) => AMapMarker;
  Pixel: new (x: number, y: number) => unknown;
  plugin: (plugins: string[], callback: () => void) => void;
  Geolocation?: new (options: Record<string, unknown>) => {
    getCurrentPosition: (callback: (status: string, result: AMapLocationResult) => void) => void;
  };
}
type AMapWindow = Window & {
  AMap?: AMapNamespace;
  _AMapSecurityConfig?: { securityJsCode: string };
  __cityWanderAMapReady?: () => void;
};
let sdkPromise: Promise<AMapNamespace> | null = null;

/** Share one SDK load between route previews and the starting-point picker. */
export function loadAMap(config: AppConfig): Promise<AMapNamespace> {
  if (!config.jsKey.trim()) return Promise.reject(new Error('请先配置高德地图 JS Key，再使用地图选点。'));
  const host = window as AMapWindow;
  if (host.AMap) return Promise.resolve(host.AMap);
  if (sdkPromise) return sdkPromise;
  host._AMapSecurityConfig = { securityJsCode: config.securityJsCode };
  // https://lbs.amap.com/api/javascript-api-v2/guide/abc/load
  sdkPromise = new Promise<AMapNamespace>((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;
    const clean = () => { clearTimeout(timeout); delete host.__cityWanderAMapReady; };
    const fail = () => {
      if (settled) return;
      settled = true;
      clean();
      script.remove();
      reject(new Error('高德底图加载失败，请检查网络和地图 Key 配置。'));
    };
    const timeout = setTimeout(fail, 15000);
    host.__cityWanderAMapReady = () => {
      if (settled) return;
      if (!host.AMap) { fail(); return; }
      settled = true;
      clean();
      resolve(host.AMap);
    };
    script.async = true;
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(config.jsKey)}&callback=__cityWanderAMapReady`;
    script.onerror = fail;
    document.head.appendChild(script);
  }).catch((error: unknown) => { sdkPromise = null; throw error; });
  return sdkPromise;
}
