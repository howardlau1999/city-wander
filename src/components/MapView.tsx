import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppConfig, Coordinate, Place, WanderRoute } from '../../shared/types';
import { loadAMap, type AMapInstance, type AMapNamespace, type MapOverlay } from '../lib/amap-sdk';
import './map-view.css';

interface MapViewProps {
  routes: WanderRoute[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  origin: Place;
  config: AppConfig | null;
  fitKey: number;
}

const COLORS = ['#2b5845', '#cd7955', '#788d9e'];
const WEST_LAKE: Coordinate[] = [[120.137,30.266],[120.145,30.267],[120.152,30.263],[120.157,30.258],[120.159,30.253],[120.158,30.244],[120.153,30.237],[120.144,30.231],[120.135,30.235],[120.13,30.243],[120.128,30.253],[120.132,30.261]];
const RIVER: Coordinate[] = [[120.115,30.17],[120.135,30.185],[120.16,30.195],[120.185,30.207],[120.21,30.218],[120.235,30.235],[120.26,30.254],[120.284,30.267],[120.30,30.274]];
const MAIN_ROADS: Coordinate[][] = [
  [[120.115,30.277],[120.142,30.275],[120.164,30.273],[120.186,30.274],[120.218,30.279],[120.25,30.285]],
  [[120.159,30.31],[120.161,30.286],[120.164,30.264],[120.169,30.246],[120.174,30.228],[120.181,30.21]],
  [[120.184,30.31],[120.183,30.289],[120.181,30.269],[120.183,30.251],[120.194,30.234],[120.211,30.218],[120.229,30.201]],
  [[120.13,30.301],[120.146,30.29],[120.166,30.283],[120.187,30.279],[120.215,30.274],[120.24,30.267]],
  [[120.16,30.256],[120.178,30.256],[120.199,30.255],[120.221,30.249],[120.244,30.239]],
  [[120.15,30.233],[120.163,30.231],[120.181,30.234],[120.2,30.239],[120.217,30.246]],
  [[120.161,30.199],[120.183,30.219],[120.202,30.242],[120.219,30.265],[120.233,30.286]],
];

function SmallIcon({ type }: { type: 'plus' | 'minus' | 'fit' | 'compass' }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    {type === 'plus' && <path d="M12 5v14M5 12h14" />}
    {type === 'minus' && <path d="M5 12h14" />}
    {type === 'fit' && <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /><circle cx="12" cy="12" r="3" /></>}
    {type === 'compass' && <><circle cx="12" cy="12" r="9" /><path d="m16 8-2.8 5.2L8 16l2.8-5.2L16 8Z" /></>}
  </svg>;
}

export default function MapView({ routes, selectedId, onSelect, origin, config, fitKey }: MapViewProps) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapInstance | null>(null);
  const overlaysRef = useRef<MapOverlay[]>([]);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const [sdk, setSdk] = useState<AMapNamespace | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [retry, setRetry] = useState(0);
  const isDemo = routes.length === 0 || routes.every((route) => route.source === 'demo');
  const wantLiveMap = Boolean(config?.jsKey) && !isDemo;
  const selected = routes.find((route) => route.id === selectedId) ?? routes[0];
  const activeOrigin = selected?.origin ?? origin;

  useEffect(() => {
    setZoom(1);
  }, [fitKey, routes]);

  useEffect(() => {
    if (!wantLiveMap || !config || !mapElement.current) {
      setSdk(null);
      setMapReady(false);
      setMapError(null);
      return;
    }
    let cancelled = false;
    let localMap: AMapInstance | null = null;
    let mapTimeout: ReturnType<typeof setTimeout> | undefined;
    setMapError(null);
    setMapReady(false);
    setSdk(null);
    loadAMap(config).then((amap) => {
      if (cancelled || !mapElement.current) return;
      localMap = new amap.Map(mapElement.current, {
        zoom: 12, center: activeOrigin.location, viewMode: '2D', mapStyle: 'amap://styles/normal',
      });
      mapRef.current = localMap;
      localMap.on('complete', () => {
        if (cancelled) return;
        clearTimeout(mapTimeout);
        setMapReady(true);
      });
      mapTimeout = setTimeout(() => {
        if (!cancelled) setMapError('高德底图暂时无法显示，已切换为无底图的真实路径预览。');
      }, 18000);
      setSdk(amap);
    }).catch((error: unknown) => {
      if (!cancelled) setMapError(error instanceof Error ? error.message : '高德底图加载失败。');
    });
    return () => {
      cancelled = true;
      clearTimeout(mapTimeout);
      overlaysRef.current = [];
      localMap?.destroy();
      if (mapRef.current === localMap) mapRef.current = null;
    };
    // A map is retained while selection and route overlays change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantLiveMap, config?.jsKey, config?.securityJsCode, retry]);

  useEffect(() => {
    const map = mapRef.current;
    if (!sdk || !map || !wantLiveMap) return;
    map.remove(overlaysRef.current);
    const overlays: MapOverlay[] = [];
    [...routes].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId)).forEach((route) => {
      const isSelected = route.id === selectedId || (!selectedId && route.id === routes[0]?.id);
      const path = new sdk.Polyline({
        path: route.polyline, strokeColor: isSelected ? COLORS[0] : COLORS[routes.indexOf(route) % COLORS.length],
        strokeWeight: isSelected ? 7 : 4, strokeOpacity: isSelected ? 1 : 0.5,
        outlineColor: '#ffffff', isOutline: true, borderWeight: 2, lineJoin: 'round', lineCap: 'round',
        zIndex: isSelected ? 80 : 50, showDir: isSelected,
        cursor: 'pointer',
      });
      path.on('click', () => selectRef.current(route.id));
      overlays.push(path);
    });
    const places = [activeOrigin, ...(selected?.waypoints ?? [])];
    places.forEach((place, index) => {
      const element = document.createElement('div');
      element.className = `cw-amap-pin ${index === 0 ? 'cw-amap-pin-origin' : ''}`;
      element.textContent = index === 0 ? '起' : String(index);
      element.title = place.name;
      overlays.push(new sdk.Marker({ position: place.location, content: element, offset: new sdk.Pixel(-16, -16), zIndex: 120 }));
    });
    overlaysRef.current = overlays;
    map.add(overlays);
    map.setFitView(overlays, true, [80, 65, 100, 65]);
  }, [sdk, routes, selectedId, activeOrigin, selected, fitKey, wantLiveMap]);

  const projection = useMemo(() => {
    const points = routes.flatMap((route) => route.polyline);
    points.push(activeOrigin.location);
    const longitudeScale = Math.cos(activeOrigin.location[1] * Math.PI / 180);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [lng, lat] of points) {
      const x = lng * longitudeScale;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, lat); maxY = Math.max(maxY, lat);
    }
    const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
    const spanX = Math.max(maxX - minX, 0.035), spanY = Math.max(maxY - minY, 0.025);
    const scale = Math.min(690 / spanX, 395 / spanY);
    const project = ([lng, lat]: Coordinate) => [450 + (lng * longitudeScale - midX) * scale, 310 - (lat - midY) * scale];
    const path = (coordinates: Coordinate[]) => coordinates.map((coordinate, index) => `${index === 0 ? 'M' : 'L'}${project(coordinate).map((value) => value.toFixed(1)).join(',')}`).join(' ');
    return { project, path };
  }, [routes, activeOrigin]);

  const hasLiveMap = wantLiveMap && !mapError;
  const handleZoom = (delta: number) => {
    if (hasLiveMap && mapRef.current) mapRef.current.setZoom(mapRef.current.getZoom() + delta);
    else setZoom((value) => Math.max(0.7, Math.min(2.5, value + delta * 0.2)));
  };
  const fit = () => {
    if (hasLiveMap && mapRef.current) mapRef.current.setFitView(overlaysRef.current, true, [80, 65, 100, 65]);
    else setZoom(1);
  };
  const [originX, originY] = projection.project(activeOrigin.location);

  return <div className="cw-map" aria-label={isDemo ? '杭州路线示意图，不能用于导航' : '高德路线预览'}>
    <div ref={mapElement} className={`cw-map-live ${hasLiveMap ? '' : 'cw-map-hidden'}`} />
    {!hasLiveMap && <svg className="cw-map-art" viewBox="0 0 900 640" role="img" aria-label={isDemo ? '杭州城市与候选环线的艺术示意图' : '真实路线几何预览，当前未加载底图'}>
      <defs>
        <pattern id="cw-map-paper" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#dedfd5" strokeWidth="0.7" opacity="0.5" /></pattern>
        <filter id="cw-marker-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#24382d" floodOpacity=".2" /></filter>
      </defs>
      <rect width="900" height="640" fill="#efeee5" />
      <rect width="900" height="640" fill="url(#cw-map-paper)" />
      <g transform={`translate(450 320) scale(${zoom}) translate(-450 -320)`}>
        {isDemo && <g className="cw-map-geography">
          <path d={projection.path([[120.09,30.28],[120.12,30.275],[120.124,30.255],[120.12,30.23],[120.13,30.218],[120.145,30.214],[120.139,30.198],[120.09,30.199]]) + 'Z'} fill="#dce4d2" />
          <path d={projection.path([[120.19,30.248],[120.199,30.249],[120.205,30.242],[120.199,30.235],[120.188,30.238]]) + 'Z'} fill="#dce4d2" />
          <path d={projection.path([[120.139,30.276],[120.148,30.277],[120.153,30.272],[120.147,30.269],[120.14,30.271]]) + 'Z'} fill="#dae3ce" />
          {Array.from({ length: 22 }, (_, index) => {
            const lng = 120.08 + index * 0.008;
            return <path key={`v${index}`} d={projection.path([[lng,30.16],[lng + 0.004,30.23],[lng + 0.001,30.34]])} fill="none" stroke="#faf9f3" strokeWidth="5" />;
          })}
          {Array.from({ length: 18 }, (_, index) => {
            const lat = 30.17 + index * 0.009;
            return <path key={`h${index}`} d={projection.path([[120.08,lat],[120.17,lat + 0.003],[120.3,lat - 0.004]])} fill="none" stroke="#faf9f3" strokeWidth="5" />;
          })}
          <path d={projection.path(RIVER)} fill="none" stroke="#d2e2df" strokeWidth="55" strokeLinecap="round" />
          <path d={projection.path(RIVER)} fill="none" stroke="#e8efdf" strokeWidth="64" strokeLinecap="round" opacity="0.3" />
          {MAIN_ROADS.map((road, index) => <g key={index}><path d={projection.path(road)} fill="none" stroke="#dcddd2" strokeWidth="13" strokeLinejoin="round" /><path d={projection.path(road)} fill="none" stroke="#fffdf5" strokeWidth="9" strokeLinejoin="round" /></g>)}
          <path d={projection.path(WEST_LAKE) + 'Z'} fill="#c8ddd8" stroke="#d8e4d4" strokeWidth="6" strokeLinejoin="round" />
          <path d={projection.path([[120.14,30.261],[120.145,30.247],[120.149,30.234]])} stroke="#e6ecda" strokeWidth="3" fill="none" />
          {([{ name: '西 湖', point: [120.144,30.25], kind: 'water' },{ name: '钱 塘 江', point: [120.218,30.225], kind: 'water' },{ name: '上 城 区', point: [120.185,30.249], kind: 'district' },{ name: '拱 墅 区', point: [120.17,30.295], kind: 'district' },{ name: '滨 江 区', point: [120.21,30.19], kind: 'district' }] as {name:string;point:Coordinate;kind:string}[]).map((label) => {
            const [x, y] = projection.project(label.point);
            return <text key={label.name} x={x} y={y} textAnchor="middle" className={`cw-map-label cw-map-label-${label.kind}`}>{label.name}</text>;
          })}
        </g>}
        {[...routes].sort((a, b) => Number(a.id === selected?.id) - Number(b.id === selected?.id)).map((route) => {
          const chosen = route.id === selected?.id;
          const color = chosen ? COLORS[0] : COLORS[routes.indexOf(route) % COLORS.length];
          return <g key={route.id} className="cw-route-line" role="button" tabIndex={0} aria-label={`预览${route.name}`} onClick={() => onSelect(route.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(route.id); } }}>
            <path d={projection.path(route.polyline)} fill="none" stroke="#fffef8" strokeWidth={chosen ? 11 : 8} strokeLinejoin="round" strokeLinecap="round" opacity={chosen ? 1 : 0.8} />
            <path d={projection.path(route.polyline)} fill="none" stroke={color} strokeWidth={chosen ? 5 : 3.5} strokeLinejoin="round" strokeLinecap="round" opacity={chosen ? 1 : 0.55} strokeDasharray={chosen ? undefined : '8 5'} />
            <path d={projection.path(route.polyline)} fill="none" stroke="transparent" strokeWidth="22" />
          </g>;
        })}
        {(selected?.waypoints ?? []).map((waypoint, index) => {
          const [x, y] = projection.project(waypoint.location);
          const textAnchor = x > 650 ? 'end' : 'start';
          return <g key={`${waypoint.id}-${index}`}><title>{waypoint.name}</title><circle cx={x} cy={y} r="16" fill="#fffdf8" stroke="#2b5845" strokeWidth="2" filter="url(#cw-marker-shadow)" /><text x={x} y={y + 5} textAnchor="middle" fill="#2b5845" fontSize="14" fontWeight="700">{index + 1}</text><text x={x + (textAnchor === 'end' ? -24 : 24)} y={y + 4} textAnchor={textAnchor} className="cw-waypoint-name">{waypoint.name}</text></g>;
        })}
        <g><circle cx={originX} cy={originY} r="25" fill="#2b5845" opacity="0.1" /><circle cx={originX} cy={originY} r="15" fill="#2b5845" stroke="#fffef8" strokeWidth="4" filter="url(#cw-marker-shadow)" /><circle cx={originX} cy={originY} r="4" fill="white" /><rect x={originX - 40} y={originY + 25} width="80" height="27" rx="7" fill="#fffdf8" stroke="#e1e4d9" /><text x={originX} y={originY + 43} textAnchor="middle" fill="#2b5845" fontSize="12" fontWeight="600">出发 · 返回</text></g>
      </g>
    </svg>}
    <div className="cw-map-topline"><span className="cw-map-location"><span className="cw-map-location-dot" />{isDemo ? '杭州 · 路线示意' : hasLiveMap ? '高德地图 · 路线预览' : '真实路径 · 无底图预览'}</span><span className="cw-map-compass"><SmallIcon type="compass" /><span>N</span></span></div>
    {hasLiveMap && !mapReady && <div className="cw-map-loading"><span className="cw-map-spinner" />正在加载高德地图…</div>}
    {mapError && <div className="cw-map-error" role="status">{mapError}<button type="button" onClick={() => setRetry((value) => value + 1)}>重试底图</button></div>}
    {!isDemo && !config?.jsKey && <div className="cw-map-error" role="status">已取得真实路线；配置地图 JS Key 后可查看道路底图。</div>}
    <div className="cw-map-controls"><button type="button" onClick={() => handleZoom(1)} aria-label="放大地图" title="放大"><SmallIcon type="plus" /></button><button type="button" onClick={() => handleZoom(-1)} aria-label="缩小地图" title="缩小"><SmallIcon type="minus" /></button><button type="button" onClick={fit} aria-label="查看完整路线" title="查看完整路线"><SmallIcon type="fit" /></button></div>
    <div className="cw-map-bottom"><div className="cw-map-legend">{routes.map((route, index) => <button type="button" key={route.id} className={route.id === selected?.id ? 'is-active' : ''} onClick={() => onSelect(route.id)} aria-pressed={route.id === selected?.id}><span style={{ backgroundColor: route.id === selected?.id ? COLORS[0] : COLORS[index % COLORS.length] }} />路线 {String(index + 1).padStart(2, '0')}</button>)}</div><span className="cw-map-disclaimer">{isDemo ? '示意路径 · 不可用于导航' : hasLiveMap ? '路线由高德地图提供' : '仅展示路径几何 · 无道路底图'}</span></div>
  </div>;
}
