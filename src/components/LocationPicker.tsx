import { useEffect, useRef, useState } from 'react';
import { Check, Crosshair, LoaderCircle, MapPin, Minus, Plus, RotateCcw } from 'lucide-react';
import type { AppConfig, Coordinate, Place } from '../../shared/types';
import { loadAMap, type AMapInstance, type AMapLngLat, type AMapMarker, type AMapNamespace } from '../lib/amap-sdk';
import './location-picker.css';

interface LocationPickerProps {
  config: AppConfig | null;
  initialPlace: Place;
  onConfirm: (place: Place) => void;
  onCancel: () => void;
  notice?: string;
}

function readCoordinate(point?: AMapLngLat): Coordinate | null {
  if (!point || typeof point.getLng !== 'function' || typeof point.getLat !== 'function') return null;
  const lng = point.getLng(), lat = point.getLat();
  return Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90
    ? [Number(lng.toFixed(6)), Number(lat.toFixed(6))] : null;
}

/** All coordinates here come from AMap and are already GCJ-02. */
export default function LocationPicker({ config, initialPlace, onConfirm, onCancel, notice }: LocationPickerProps) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapInstance | null>(null);
  const markerRef = useRef<AMapMarker | null>(null);
  const sdkRef = useRef<AMapNamespace | null>(null);
  const generation = useRef(0);
  const auxiliaryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<Coordinate | null>(null);
  const [error, setError] = useState('');
  const [mapError, setMapError] = useState('');
  const [estimating, setEstimating] = useState(false);
  const [estimateNote, setEstimateNote] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    setSelected(null); setReady(false); setError(''); setMapError(''); setEstimateNote(''); setEstimating(false);
    if (!config?.jsKey) { setMapError('尚未配置地图 JS Key。可以关闭窗口，先搜索出发地点。'); return; }
    let localMap: AMapInstance | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const active = () => currentGeneration === generation.current;
    loadAMap(config).then(amap => {
      if (!active() || !mapElement.current) return;
      sdkRef.current = amap;
      localMap = new amap.Map(mapElement.current, { center: initialPlace.location, zoom: 15, viewMode: '2D', resizeEnable: true, cursor: 'crosshair' });
      mapRef.current = localMap;
      const markerElement = document.createElement('div');
      markerElement.className = 'location-picker-pin';
      markerElement.textContent = '起';
      const marker = new amap.Marker({ position: initialPlace.location, content: markerElement, offset: new amap.Pixel(-15, -15), zIndex: 100 });
      markerRef.current = marker;
      localMap.add([marker]);
      localMap.on('click', event => {
        if (!active()) return;
        const position = readCoordinate(event.lnglat);
        if (!position) { setError('未获取到有效坐标，请在地图上重新点一下。'); return; }
        clearTimeout(auxiliaryTimer.current);
        setEstimating(false);
        // Invalidate a pending auxiliary lookup without destroying this map's lifecycle.
        auxiliaryRequest.current += 1;
        marker.setPosition(position);
        setSelected(position); setError(''); setEstimateNote('');
      });
      localMap.on('complete', () => { if (active()) { clearTimeout(timer); setReady(true); setMapError(''); } });
      timer = setTimeout(() => { if (active()) setMapError('地图加载超时，请检查网络后重试，或关闭窗口搜索地点。'); }, 18000);
    }).catch((reason: unknown) => { if (active()) setMapError(reason instanceof Error ? reason.message : '地图暂时无法加载，请稍后重试。'); });
    return () => {
      generation.current += 1;
      clearTimeout(timer); clearTimeout(auxiliaryTimer.current);
      auxiliaryRequest.current += 1;
      localMap?.destroy();
      if (mapRef.current === localMap) { mapRef.current = null; markerRef.current = null; sdkRef.current = null; }
    };
  }, [config?.jsKey, config?.securityJsCode, initialPlace.id, retry]);

  const auxiliaryRequest = useRef(0);
  function chooseCenter() {
    const location = readCoordinate(mapRef.current?.getCenter());
    if (!location) { setError('地图还没有准备好，请稍后再试。'); return; }
    auxiliaryRequest.current += 1;
    clearTimeout(auxiliaryTimer.current); setEstimating(false);
    markerRef.current?.setPosition(location);
    setSelected(location); setError(''); setEstimateNote('');
  }
  function reset() {
    auxiliaryRequest.current += 1;
    clearTimeout(auxiliaryTimer.current); setEstimating(false);
    mapRef.current?.setCenter(initialPlace.location);
    mapRef.current?.setZoom(15);
    markerRef.current?.setPosition(initialPlace.location);
    setSelected(null); setError(''); setEstimateNote('');
  }
  function estimateNearby() {
    const amap = sdkRef.current, map = mapRef.current;
    if (!amap || !map || !ready) return;
    const currentGeneration = generation.current;
    const request = ++auxiliaryRequest.current;
    const active = () => currentGeneration === generation.current && request === auxiliaryRequest.current;
    setEstimating(true); setError(''); setSelected(null); setEstimateNote('');
    clearTimeout(auxiliaryTimer.current);
    auxiliaryTimer.current = setTimeout(() => {
      if (!active()) return;
      auxiliaryRequest.current += 1;
      setEstimating(false); setError('未能估计附近位置。仍可拖动地图并点选出发位置。');
    }, 18000);
    // User initiated only. IP results have unknown accuracy and always need confirmation.
    // https://lbs.amap.com/api/javascript-api-v2/guide/services/geolocation
    try {
      amap.plugin(['AMap.Geolocation'], () => {
        if (!active()) return;
        if (!amap.Geolocation) { clearTimeout(auxiliaryTimer.current); setEstimating(false); setError('辅助定位暂时不可用，请直接在地图上选点。'); return; }
        const geolocation = new amap.Geolocation({ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000, convert: true, showButton: false, showMarker: false, showCircle: false, panToLocation: false, zoomToAccuracy: false });
        geolocation.getCurrentPosition((status, result) => {
          if (!active()) return;
          clearTimeout(auxiliaryTimer.current); setEstimating(false);
          const location = readCoordinate(result?.position);
          if (status !== 'complete' || !location || result?.isConverted === false) { setError('辅助定位未返回可用位置。请拖动地图并点选出发位置。'); return; }
          map.setCenter(location); map.setZoom(15); markerRef.current?.setPosition(location);
          const accuracy = Number(result.accuracy);
          setEstimateNote(Number.isFinite(accuracy) && accuracy > 0
            ? `地图已移到估计位置（返回精度约 ${Math.round(accuracy)} 米）。请核对并点选出发位置。`
            : '地图已移到估计位置，精度未知，可能偏离较远。请核对并点选出发位置。');
          // Do not silently promote an IP estimate into the user's precise origin.
          setSelected(null);
        });
      });
    } catch {
      clearTimeout(auxiliaryTimer.current); setEstimating(false); setError('辅助定位暂时不可用，请直接在地图上选点。');
    }
  }
  function confirm() {
    if (!selected || !ready || mapError) return;
    onConfirm({
      id: `map-${selected[0].toFixed(6)}-${selected[1].toFixed(6)}`,
      name: '地图选定位置', location: selected,
      address: `地图选点 · ${selected[0].toFixed(6)}, ${selected[1].toFixed(6)}`,
    });
  }

  return <div className="location-picker">
    <span className="dialog-eyebrow">START SOMEWHERE YOU LIKE</span>
    <h2>在地图上，选个起点。</h2>
    <p className="location-picker-intro">拖动、缩放地图，点一下你准备出发的位置。选点不需要浏览器定位权限。</p>
    {notice && <p className="location-picker-notice">{notice}</p>}
    <div className="location-picker-map-wrap">
      <div ref={mapElement} className="location-picker-map" aria-label="选择出发地点的高德地图" />
      {!ready && !mapError && <div className="location-picker-loading"><LoaderCircle className="spin" size={22} /><span>正在加载高德地图…</span></div>}
      {mapError && <div className="location-picker-map-error" role="status"><MapPin size={24} /><p>{mapError}</p>{config?.jsKey && <button className="secondary-button" onClick={() => setRetry(value => value + 1)}>重试地图</button>}</div>}
      {ready && !mapError && <div className="location-picker-controls"><button type="button" aria-label="放大选点地图" onClick={() => mapRef.current?.setZoom(mapRef.current.getZoom() + 1)}><Plus size={18} /></button><button type="button" aria-label="缩小选点地图" onClick={() => mapRef.current?.setZoom(mapRef.current.getZoom() - 1)}><Minus size={18} /></button><button type="button" aria-label="返回当前起点" onClick={reset}><RotateCcw size={16} /></button></div>}
    </div>
    <div className="location-picker-tools"><button type="button" className="text-button" onClick={estimateNearby} disabled={!ready || !!mapError || estimating}>{estimating ? <LoaderCircle size={14} className="spin" /> : <Crosshair size={14} />}{estimating ? '正在估计附近位置…' : '估计附近位置'}</button><button type="button" className="text-button" onClick={chooseCenter} disabled={!ready || !!mapError}>选地图中心<MapPin size={14} /></button></div>
    <p className="location-picker-assistance">辅助定位可能使用 IP 估计，只用于移动地图，需你核对后选点。</p>
    {error && <p className="location-picker-notice" role="alert">{error}</p>}
    {estimateNote && <p className="location-picker-notice" role="status">{estimateNote}</p>}
    <div className="location-picker-selection" aria-live="polite"><MapPin size={17} /><div><strong>{selected ? '已选出发位置' : estimateNote ? '估计位置，尚未设为起点' : `当前起点：${initialPlace.name}`}</strong><small>{selected ? `${selected[0].toFixed(6)}, ${selected[1].toFixed(6)}` : estimateNote ? '请在估计位置附近点选，或选择地图中心' : '点一下地图以选择新起点'}</small></div>{selected && <Check size={16} />}</div>
    <div className="location-picker-actions"><button type="button" className="secondary-button" onClick={onCancel}>取消</button><button type="button" className="primary-button" onClick={confirm} disabled={!selected || !ready || !!mapError}><Check size={16} />从这里出发</button></div>
  </div>;
}
