import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppConfig, Coordinate, Place, WanderRoute } from '../../shared/types';
import { loadAMap, type AMapInstance, type AMapNamespace, type MapOverlay } from '../lib/amap-sdk';
import './map-view.css';

interface MapViewProps {
  routes: WanderRoute[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  origin: Place;
  originConfirmed?: boolean;
  config: AppConfig | null;
  fitKey: number;
}

const COLORS = ['#2b5845', '#cd7955', '#788d9e'];

function SmallIcon({ type }: { type: 'plus' | 'minus' | 'fit' | 'compass' }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    {type === 'plus' && <path d="M12 5v14M5 12h14" />}
    {type === 'minus' && <path d="M5 12h14" />}
    {type === 'fit' && <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /><circle cx="12" cy="12" r="3" /></>}
    {type === 'compass' && <><circle cx="12" cy="12" r="9" /><path d="m16 8-2.8 5.2L8 16l2.8-5.2L16 8Z" /></>}
  </svg>;
}

export default function MapView({ routes, selectedId, onSelect, origin, originConfirmed = true, config, fitKey }: MapViewProps) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapInstance | null>(null);
  const overlaysRef = useRef<MapOverlay[]>([]);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const [sdk, setSdk] = useState<AMapNamespace | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapGeneration, setMapGeneration] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [retry, setRetry] = useState(0);
  const isEmpty = routes.length === 0;
  const isDemo = !isEmpty && routes.every((route) => route.source === 'demo');
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
        zoom: originConfirmed ? 14 : 11, center: activeOrigin.location, viewMode: '2D', mapStyle: 'amap://styles/normal',
      });
      mapRef.current = localMap;
      setMapGeneration(value => value + 1);
      localMap.on('complete', () => {
        if (cancelled) return;
        clearTimeout(mapTimeout);
        setMapError(null);
        setMapReady(true);
      });
      mapTimeout = setTimeout(() => {
        if (!cancelled) setMapError('高德底图暂时无法显示，请重试加载。');
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
    const places = originConfirmed || !isEmpty ? [activeOrigin, ...(selected?.waypoints ?? [])] : [];
    places.forEach((place, index) => {
      const element = document.createElement('div');
      element.className = `cw-amap-pin ${index === 0 ? 'cw-amap-pin-origin' : ''}`;
      element.textContent = index === 0 ? '起' : String(index);
      element.title = place.name;
      overlays.push(new sdk.Marker({ position: place.location, content: element, offset: new sdk.Pixel(-16, -16), zIndex: 120 }));
    });
    overlaysRef.current = overlays;
    if (overlays.length) map.add(overlays);
    if (isEmpty) {
      map.setCenter(activeOrigin.location);
      map.setZoom(originConfirmed ? 14 : 11);
    } else map.setFitView(overlays, true, [80, 65, 100, 65]);
  }, [sdk, mapGeneration, routes, selectedId, activeOrigin, selected, fitKey, wantLiveMap, isEmpty, originConfirmed]);

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
    if (hasLiveMap && mapRef.current) {
      if (isEmpty) {
        mapRef.current.setCenter(activeOrigin.location);
        mapRef.current.setZoom(originConfirmed ? 14 : 11);
      } else mapRef.current.setFitView(overlaysRef.current, true, [80, 65, 100, 65]);
    }
    else setZoom(1);
  };
  const [originX, originY] = projection.project(activeOrigin.location);
  const cityName = activeOrigin.city?.name;

  return <div className="cw-map" aria-label={isEmpty ? '等待选择起点并生成路线' : isDemo ? '路线示意图，不能用于导航' : '高德路线预览'}>
    <div ref={mapElement} className={`cw-map-live ${hasLiveMap ? '' : 'cw-map-hidden'}`} />
    {!hasLiveMap && <svg className="cw-map-art" viewBox="0 0 900 640" role="img" aria-label={isEmpty ? '尚未生成路线，无道路底图' : isDemo ? '候选环线的艺术示意图，无道路底图' : '真实路线几何预览，当前未加载底图'}>
      <defs>
        <pattern id="cw-map-paper" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#dedfd5" strokeWidth="0.7" opacity="0.5" /></pattern>
        <filter id="cw-marker-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#24382d" floodOpacity=".2" /></filter>
      </defs>
      <rect width="900" height="640" fill="#efeee5" />
      <rect width="900" height="640" fill="url(#cw-map-paper)" />
      <g transform={`translate(450 320) scale(${zoom}) translate(-450 -320)`}>
        {(isDemo || isEmpty) && <g aria-hidden="true" fill="none" stroke="#d5dfcc" strokeWidth="1.5" strokeDasharray="5 10">
          {[125, 215, 305].map(radius => <circle key={radius} cx="450" cy="310" r={radius} />)}
          <path d="M90 310H810M450 30V590" />
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
        {!isEmpty && <g><circle cx={originX} cy={originY} r="25" fill="#2b5845" opacity="0.1" /><circle cx={originX} cy={originY} r="15" fill="#2b5845" stroke="#fffef8" strokeWidth="4" filter="url(#cw-marker-shadow)" /><circle cx={originX} cy={originY} r="4" fill="white" /><rect x={originX - 40} y={originY + 25} width="80" height="27" rx="7" fill="#fffdf8" stroke="#e1e4d9" /><text x={originX} y={originY + 43} textAnchor="middle" fill="#2b5845" fontSize="12" fontWeight="600">出发 · 返回</text></g>}
      </g>
    </svg>}
    <div className="cw-map-topline"><span className="cw-map-location"><span className="cw-map-location-dot" />{isEmpty ? `${cityName || '当前城市'} · ${hasLiveMap ? '高德地图' : '等待出发'}` : isDemo ? `${cityName || '城市漫游'} · 路线示意` : hasLiveMap ? '高德地图 · 路线预览' : '真实路径 · 无底图预览'}</span><span className="cw-map-compass"><SmallIcon type="compass" /><span>N</span></span></div>
    {isEmpty && (!hasLiveMap || mapReady) && <div className={`cw-map-empty ${hasLiveMap ? 'cw-map-empty-live' : ''}`} role="status"><SmallIcon type="compass" /><strong>{originConfirmed ? '起点已选好，出发的方向由你决定' : `从${cityName || '这座城市'}，开始新的一圈`}</strong><p>{originConfirmed ? '选好时间和偏好，再生成你的漫游路线。' : '搜索出发地点，或用地图选点与定位确定起点。'}</p>{!hasLiveMap && <small>当前没有道路底图</small>}</div>}
    {hasLiveMap && !mapReady && <div className="cw-map-loading"><span className="cw-map-spinner" />正在加载高德地图…</div>}
    {mapError && <div className="cw-map-error" role="status">{mapError}<button type="button" onClick={() => setRetry((value) => value + 1)}>重试底图</button></div>}
    {!isEmpty && !isDemo && !config?.jsKey && <div className="cw-map-error" role="status">已取得真实路线；配置地图 JS Key 后可查看道路底图。</div>}
    <div className="cw-map-controls"><button type="button" onClick={() => handleZoom(1)} aria-label="放大地图" title="放大"><SmallIcon type="plus" /></button><button type="button" onClick={() => handleZoom(-1)} aria-label="缩小地图" title="缩小"><SmallIcon type="minus" /></button><button type="button" onClick={fit} aria-label="查看完整路线" title="查看完整路线"><SmallIcon type="fit" /></button></div>
    <div className="cw-map-bottom"><div className="cw-map-legend">{routes.map((route, index) => <button type="button" key={route.id} className={route.id === selected?.id ? 'is-active' : ''} onClick={() => onSelect(route.id)} aria-pressed={route.id === selected?.id}><span style={{ backgroundColor: route.id === selected?.id ? COLORS[0] : COLORS[index % COLORS.length] }} />路线 {String(index + 1).padStart(2, '0')}</button>)}</div><span className="cw-map-disclaimer">{isEmpty ? hasLiveMap ? '高德地图 · 尚未生成路线' : '尚未生成路线 · 无道路底图' : isDemo ? '示意路径 · 不可用于导航' : hasLiveMap ? '路线由高德地图提供' : '仅展示路径几何 · 无道路底图'}</span></div>
  </div>;
}
