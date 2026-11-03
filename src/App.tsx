import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, CarFront, Check, ChevronRight, CircleHelp, Compass, Copy, Footprints, Heart, Leaf, LoaderCircle, LocateFixed, MapPin, Navigation, RotateCcw, Route, Search, Shuffle, SlidersHorizontal, Sparkles, Trees, Waves, X } from 'lucide-react';
import type { AppConfig, Place, PlanRequest, PlanResponse, Preference, TravelMode, WanderRoute } from '../shared/types';
import MapView from './components/MapView';
import LocationPicker from './components/LocationPicker';
import { getBrowserPosition, locationAvailability, locationErrorIssue, type LocationIssue } from './lib/geolocation';
import { createDemoPlan } from './lib/demo';
import { buildAppRouteUrl, buildLegWebUrl, routeLegs } from './lib/amap-links';

const DEFAULT_ORIGIN: Place = { id: 'B023B1FB36', name: '城市阳台', location: [120.215387, 30.240228], address: '杭州市上城区 · 之江路1078号' };
const INITIAL_REQUEST: PlanRequest = { origin: DEFAULT_ORIGIN, mode: 'driving', minutes: 60, preference: 'park', seed: 42 };
const PREFERENCES: { id: Preference; title: string; subtitle: string; icon: typeof Leaf }[] = [
  { id: 'surprise', title: '随心漫游', subtitle: '让城市给点惊喜', icon: Shuffle },
  { id: 'park', title: '遇见绿意', subtitle: '途经公园与绿地', icon: Trees },
  { id: 'waterfront', title: '沿水而行', subtitle: '寻找江岸与湖畔', icon: Waves },
  { id: 'elevated', title: '高架兜风', subtitle: '偏好开阔的大路', icon: Route },
];
const modeName = (mode: TravelMode) => mode === 'driving' ? '开车兜风' : '步行漫游';
const minutesOf = (r: WanderRoute) => Math.round(r.durationSeconds / 60);
const distanceOf = (r: WanderRoute) => (r.distanceMeters / 1000).toFixed(1);
async function readApi<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || '服务暂时无法响应，请稍后再试。');
  if (!body) throw new Error('服务返回了无效数据，请检查 API 服务是否启动。');
  return body as T;
}
function getSaved(): WanderRoute[] {
  try { const stored = JSON.parse(localStorage.getItem('city-wander-saved') || '[]'); return Array.isArray(stored) ? stored.filter(r => r && typeof r.name === 'string' && Array.isArray(r.waypoints) && Array.isArray(r.polyline) && r.origin?.location && ['amap', 'demo'].includes(r.source)).slice(0, 12) : []; } catch { return []; }
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configReady, setConfigReady] = useState(false);
  const [origin, setOrigin] = useState<Place>(DEFAULT_ORIGIN);
  const [query, setQuery] = useState(DEFAULT_ORIGIN.name);
  const [places, setPlaces] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [mode, setMode] = useState<TravelMode>('driving');
  const [minutes, setMinutes] = useState(60);
  const [preference, setPreference] = useState<Preference>('park');
  const [plan, setPlan] = useState<PlanResponse>(() => createDemoPlan(INITIAL_REQUEST));
  const [plannedRequest, setPlannedRequest] = useState(INITIAL_REQUEST);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationIssue, setLocationIssue] = useState<LocationIssue | null>(null);
  const [pickerOrigin, setPickerOrigin] = useState<Place>(DEFAULT_ORIGIN);
  const [pickerNotice, setPickerNotice] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [fitKey, setFitKey] = useState(0);
  const [modal, setModal] = useState<'guide' | 'handoff' | 'saved' | 'location' | null>(null);
  const [saved, setSaved] = useState<WanderRoute[]>(getSaved);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const planController = useRef<AbortController | null>(null);
  const locationController = useRef<AbortController | null>(null);
  const originInputRef = useRef<HTMLInputElement>(null);
  const selected = plan.routes.find(r => r.id === selectedId) || plan.routes[0];
  const demo = selected?.source === 'demo';
  const dirty = origin.id !== plannedRequest.origin.id || mode !== plannedRequest.mode || minutes !== plannedRequest.minutes || preference !== plannedRequest.preference;

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/config', { signal: controller.signal }).then(readApi<AppConfig>).then(setConfig).catch(e => { if (e.name !== 'AbortError') setError('未连接到 API 服务，当前可体验演示路线。请同时启动前端与后端。'); }).finally(() => { if (!controller.signal.aborted) setConfigReady(true); });
    return () => { controller.abort(); planController.current?.abort(); locationController.current?.abort(); };
  }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (modal && dialog && !dialog.open) dialog.showModal();
    if (!modal && dialog?.open) dialog.close();
  }, [modal]);
  useEffect(() => {
    setPlaces([]); setSearchError(''); setSearching(false);
    if (query.trim() === origin.name || query.trim().length < 2) return;
    if (!config?.liveRouting) { setSearchError('连接高德后可搜索杭州的地点。演示先从城市阳台出发。'); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const body = await readApi<{ places: Place[] }>(await fetch(`/api/places?query=${encodeURIComponent(query.trim())}&city=${encodeURIComponent('杭州')}`, { signal: controller.signal }));
        setPlaces(body.places); if (!body.places.length) setSearchError('没有找到地点，试试更完整的名称。');
      } catch (e) { if (!controller.signal.aborted) setSearchError(e instanceof Error ? e.message : '搜索失败'); }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, config?.liveRouting, origin.name]);

  async function generate() {
    if (query.trim() !== origin.name) { setError('请先从搜索结果中选择出发地点，或恢复当前起点。'); return; }
    const request: PlanRequest = { origin, mode, minutes, preference, seed: Math.floor(Math.random() * 1_000_000) };
    setLoading(true); setError('');
    const controller = new AbortController(); planController.current = controller;
    try {
      const result = config?.liveRouting
        ? await readApi<PlanResponse>(await fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal }))
        : createDemoPlan(request);
      if (!result.routes.length) throw new Error('暂时没有找到合适的环线，试试更长的时间或其他偏好。');
      setPlan(result); setPlannedRequest(request); setSelectedId(result.routes[0].id); setFitKey(k => k + 1);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '规划失败，请重试。'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  function chooseOrigin(place: Place) {
    locationController.current?.abort();
    setLocating(false); setLocationIssue(null); setError('');
    setOrigin(place); setQuery(place.name); setPlaces([]);
  }
  function openLocationPicker(place: Place = origin, notice = locationIssue?.message || '') {
    locationController.current?.abort(); setLocating(false);
    setPickerOrigin(place); setPickerNotice(notice); setModal('location');
  }
  function focusOriginSearch() {
    locationController.current?.abort(); setLocating(false);
    originInputRef.current?.focus(); originInputRef.current?.select();
  }
  async function locate() {
    setError(''); setLocationIssue(null);
    const unavailable = locationAvailability(window.isSecureContext, Boolean(navigator.geolocation));
    if (unavailable) { setLocationIssue(unavailable); return; }
    if (!config?.liveRouting) { setModal('guide'); return; }
    locationController.current?.abort();
    const controller = new AbortController(); locationController.current = controller;
    setLocating(true);
    try {
      const position = await getBrowserPosition(navigator.geolocation, controller.signal);
      if (controller.signal.aborted) return;
      const result = await readApi<{ location: [number, number] }>(await fetch('/api/convert-location', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ location: [position.coords.longitude, position.coords.latitude] }),
      }));
      if (controller.signal.aborted) return;
      const accurate = Number.isFinite(position.coords.accuracy) && position.coords.accuracy <= 200;
      const place: Place = {
        id: `gps-${Date.now()}`, name: accurate ? '我的当前位置' : '待确认的定位位置', location: result.location,
        address: Number.isFinite(position.coords.accuracy) ? `定位精度约 ${Math.round(position.coords.accuracy)} 米` : '请在地图上核对起点',
      };
      if (accurate) chooseOrigin(place);
      else openLocationPicker(place, `${place.address}，请在地图上点击确认你的出发位置。`);
    } catch (e) {
      if (!controller.signal.aborted) {
        const issue = locationErrorIssue(e);
        setLocationIssue(issue.kind === 'unknown' && e instanceof Error ? { ...issue, message: e.message } : issue);
      }
    } finally { if (!controller.signal.aborted) setLocating(false); }
  }
  function toggleSaved(route: WanderRoute) {
    const next = saved.some(r => r.id === route.id) ? saved.filter(r => r.id !== route.id) : [route, ...saved].slice(0, 12);
    try { localStorage.setItem('city-wander-saved', JSON.stringify(next)); setSaved(next); setToast(next.some(r => r.id === route.id) ? '已收藏到这台设备' : '已取消收藏'); } catch { setToast('浏览器存储空间不足，未能保存'); }
  }
  async function copyRoute() {
    if (!selected) return;
    const text = `${selected.name}${demo ? '（演示路线，不可导航）' : ''}\n${modeName(selected.mode)} · 约${minutesOf(selected)}分钟 · ${distanceOf(selected)}公里\n${[selected.origin, ...selected.waypoints, selected.origin].map((p, i) => `${i + 1}. ${p.name} (${p.location.join(',')})`).join('\n')}`;
    try { await navigator.clipboard.writeText(text); setToast('路线清单已复制'); } catch { setToast('当前浏览器不支持复制，请在 HTTPS 或 localhost 下使用。'); }
  }
  function restoreRoute(route: WanderRoute) {
    setPlan({ routes: [route], warnings: ['收藏保存的是当时的估算；出发前请重新生成路线以获取最新路况。'], source: route.source });
    setSelectedId(route.id); chooseOrigin(route.origin); setMode(route.mode);
    setPlannedRequest({ origin: route.origin, mode: route.mode, minutes: minutesOf(route), preference, seed: 0 });
    setMinutes(Math.min(180, Math.max(15, minutesOf(route)))); setModal(null); setFitKey(k => k + 1);
  }

  return <div className="app-shell">
    <header className="site-header">
      <a className="brand" href="/" aria-label="漫游首页"><span className="brand-mark"><Route size={24} strokeWidth={1.6} /></span><span className="brand-name">漫游<span>CITY WANDER</span></span></a>
      <nav aria-label="主导航"><span className="nav-active">路线规划</span><button onClick={() => setModal('saved')}>我的收藏{saved.length > 0 && <span className="count">{saved.length}</span>}</button></nav>
      <div className="header-right"><span className="city-label"><MapPin size={14} />杭州</span><button className="icon-button help-button" aria-label="使用与接入指南" onClick={() => setModal('guide')}><CircleHelp size={19} /></button></div>
    </header>

    <main>
      <section className="hero"><div><p className="eyebrow"><span /> 给日常，绕一点路</p><h1>没有目的地，<span>也有好风景。</span></h1><p className="hero-description">留一点时间给自己，剩下的交给沿途。</p></div><div className="hero-note"><span className="sketch-line">↝</span><span>出发，兜一圈，再回来。<small>A LITTLE DETOUR, A NEW PERSPECTIVE.</small></span></div></section>

      <div className="workspace">
        <aside className="planner-panel">
          <div className="panel-heading"><h2>这次，怎么逛？</h2><SlidersHorizontal size={17} /></div>
          <div className="mode-switch" aria-label="出行方式">{(['driving', 'walking'] as TravelMode[]).map(value => <button key={value} aria-pressed={mode === value} className={mode === value ? 'active' : ''} onClick={() => { setMode(value); if (value === 'walking' && preference === 'elevated') setPreference('park'); }}>{value === 'driving' ? <CarFront size={17} /> : <Footprints size={17} />}{modeName(value)}</button>)}</div>
          <div className="field-heading"><label htmlFor="origin">从哪里出发</label><span className="origin-actions"><button onClick={() => openLocationPicker()} className="text-button"><MapPin size={13} />地图选点</button><button onClick={locate} disabled={locating} className="text-button">{locating ? <LoaderCircle size={13} className="spin" /> : <LocateFixed size={13} />}我的位置</button></span></div>
          <div className="search-wrapper"><div className="origin-input"><MapPin size={16} /><input ref={originInputRef} id="origin" value={query} autoComplete="off" placeholder="搜索杭州的出发地点" onChange={e => { locationController.current?.abort(); setLocating(false); setQuery(e.target.value); }} />{searching ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />}</div>
            {places.length > 0 && <ul className="place-results">{places.map(place => <li key={place.id}><button onClick={() => chooseOrigin(place)}><MapPin size={15} /><span>{place.name}<small>{place.address}</small></span></button></li>)}</ul>}
          </div>
          {searchError ? <p className="field-note search-note">{searchError}<button onClick={() => setQuery(origin.name)}>恢复起点</button></p> : <p className="field-note">{origin.address || '将从这个地点出发，再回到这里'}</p>}
          {locationIssue && <div className="location-issue" role="alert"><strong>{locationIssue.title}</strong><p>{locationIssue.message}</p><div><button onClick={() => openLocationPicker()}>地图选起点<ArrowRight size={12} /></button><button onClick={focusOriginSearch}>搜索起点</button>{['timeout', 'unavailable', 'permission', 'unknown'].includes(locationIssue.kind) && <button onClick={locate}>重试定位</button>}</div></div>}
          {!locationIssue && !window.isSecureContext && <p className="location-context-note">当前连接可搜索或地图选点；自动定位需 HTTPS。</p>}
          <div className="time-heading"><label htmlFor="duration">给自己多少时间</label><span><strong>{minutes}</strong> 分钟</span></div>
          <input className="duration-slider" id="duration" type="range" min="15" max="180" step="15" value={minutes} style={{ '--progress': `${(minutes - 15) / 165 * 100}%` } as React.CSSProperties} onChange={e => setMinutes(Number(e.target.value))} />
          <div className="duration-presets">{[30, 60, 90, 120].map(value => <button key={value} className={value === minutes ? 'active' : ''} onClick={() => setMinutes(value)}>{value < 60 ? `${value} 分钟` : `${value / 60} 小时`}</button>)}</div>
          <div className="field-heading preferences-heading"><span>想遇见什么</span><span className="optional-label">选一种心情</span></div>
          <div className="preference-grid">{PREFERENCES.map(({ id, title, subtitle, icon: Icon }) => <button key={id} disabled={mode === 'walking' && id === 'elevated'} className={`preference ${preference === id ? 'selected' : ''}`} aria-pressed={preference === id} onClick={() => setPreference(id)}><Icon size={21} strokeWidth={1.5} /><strong>{title}</strong><small>{mode === 'walking' && id === 'elevated' ? '仅支持驾车' : subtitle}</small>{preference === id && <Check size={12} className="preference-check" />}</button>)}</div>
          {preference === 'elevated' && <p className="preference-hint">以大路优先规划，并参考路名筛选；不能保证全程高架。</p>}
          <div className="roundtrip-note"><RotateCcw size={16} /><span>兜一圈，回到出发地</span><span className="on-pill">环线</span></div>
          <button className="primary-button generate-button" onClick={generate} disabled={loading || !configReady}>{loading ? <LoaderCircle className="spin" size={19} /> : <Sparkles size={18} />}{loading ? '正在寻找沿途的风景…' : '生成我的漫游路线'}{!loading && <ArrowRight size={18} />}</button>
          <p className="planner-footnote">{config?.liveRouting ? '基于高德道路规划 · 时间为路况估算' : '当前为演示体验 · 连接高德后开启真实规划'}</p>
          <button className="connection-button" onClick={() => setModal('guide')}><span className={`status-dot ${config?.liveRouting ? 'connected' : ''}`} />{config?.liveRouting ? '高德路线服务已配置' : '连接我的高德地图'}<ChevronRight size={13} /></button>
        </aside>

        <section className="preview-panel" aria-label="路线预览">
          <div className="preview-heading"><div><span className="eyebrow-small">YOUR NEXT LITTLE ESCAPE</span><h2>城市很大，随心转转。<span className="route-count">{plan.routes.length} 条{demo ? '示意' : '候选'}路线</span></h2></div><button className="shuffle-button" disabled={loading || !configReady} onClick={generate}><Shuffle size={15} />换一批</button></div>
          {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError('')} aria-label="关闭错误"><X size={15} /></button></div>}
          <div className="map-container"><MapView routes={plan.routes} selectedId={selected?.id || null} onSelect={setSelectedId} origin={plannedRequest.origin} config={config} fitKey={fitKey} />{loading && <div className="map-loading"><span><LoaderCircle className="spin" size={22} />正在计算真实道路上的环线…<small>搜索途经地点 · 比较预计用时</small></span></div>}</div>
          <div className="results-heading"><div><span className="tiny-dot" />{demo ? '灵感路线' : '为你找到这些路线'}<span className="result-context">{modeName(plannedRequest.mode)} · 目标 {plannedRequest.minutes} 分钟</span></div>{dirty && <span className="dirty-note">偏好已修改，生成后更新</span>}</div>
          <div className="route-cards">{plan.routes.map((route, i) => <button key={route.id} className={`route-card route-color-${i} ${selected?.id === route.id ? 'selected' : ''}`} onClick={() => setSelectedId(route.id)} aria-pressed={selected?.id === route.id}><div className="route-card-top"><span className="route-index">0{i + 1}</span><span className="route-recommendation">{i === 0 ? '首选推荐' : i === 1 ? '换个方向' : '多一点发现'}</span><span className="radio-mark">{selected?.id === route.id && <span />}</span></div><h3>{route.name}</h3><div className="route-metrics"><span><strong>{minutesOf(route)}</strong> 分钟</span><span className="metric-divider" /><span><strong>{distanceOf(route)}</strong> 公里</span></div><p>{route.tags.slice(0, 2).join(' · ') || route.description}</p></button>)}</div>
        </section>
      </div>

      {selected && <section className="route-detail"><div className="detail-main"><div className="detail-heading"><span className="detail-icon"><Route size={21} /></span><div><p>把这一圈，交给路上的自己</p><h2>{selected.name}</h2></div><button className={`icon-button favorite-button ${saved.some(r => r.id === selected.id) ? 'is-saved' : ''}`} aria-label={saved.some(r => r.id === selected.id) ? '取消收藏路线' : '收藏路线'} onClick={() => toggleSaved(selected)}><Heart size={19} fill={saved.some(r => r.id === selected.id) ? 'currentColor' : 'none'} /></button></div><div className="waypoint-timeline">{[selected.origin, ...selected.waypoints, selected.origin].map((place, i, all) => <div className="waypoint" key={`${place.id}-${i}`}><span className={`waypoint-dot ${i === 0 || i === all.length - 1 ? 'endpoint' : ''}`}>{i === 0 ? <span /> : i === all.length - 1 ? <Check size={10} /> : i}</span><span>{i === all.length - 1 ? '回到起点' : place.name}</span>{i !== all.length - 1 && <span className="waypoint-line" />}</div>)}</div><p className="route-description">{selected.description}</p>{selected.source === 'amap' && selected.roads.length > 0 && <p className="route-roads">主要路段 · {selected.roads.slice(0, 6).join(' → ')}</p>}</div><div className="detail-actions"><button className="primary-button handoff-button" disabled={demo} onClick={() => setModal('handoff')}><Navigation size={17} />用高德打开<ArrowUpRight size={17} /></button><button className="text-button copy-button" onClick={copyRoute}><Copy size={13} />复制路线清单</button><p>{demo ? '示意路线仅供体验，不用于导航' : '高德将重新算路 · 车机连接说明见下一步'}</p></div></section>}
      {(plan.warnings.length > 0 || selected?.warnings.length > 0) && <div className="route-notes">{[...new Set([...plan.warnings, ...(selected?.warnings || [])])].map(note => <p key={note}><span>·</span>{note}</p>)}</div>}
      <footer className="site-footer"><span><Compass size={15} />漫游，是与城市的另一种相处。</span><button onClick={() => setModal('guide')}>关于路线与高德接入<ArrowUpRight size={12} /></button></footer>
    </main>

    <dialog ref={dialogRef} onCancel={() => setModal(null)} onClick={e => { if (e.target === e.currentTarget) setModal(null); }} className={`app-dialog ${modal === 'location' ? 'location-dialog' : ''}`}><div className="dialog-content"><button className="dialog-close icon-button" onClick={() => setModal(null)} aria-label="关闭窗口"><X size={20} /></button>
      {modal === 'location' && <LocationPicker config={config} initialPlace={pickerOrigin} notice={pickerNotice} onCancel={() => setModal(null)} onConfirm={place => { chooseOrigin(place); setModal(null); setToast('已更新起点，生成路线后生效'); }} />}
      {modal === 'guide' && <><span className="dialog-eyebrow">A SMALL GUIDE</span><h2>从漫游，到真的出发。</h2><p className="dialog-intro">先选时间和沿途偏好，预览环线，再交给手机高德。</p><div className="guide-step"><span>01</span><div><h3>接入高德地图</h3><p>在本地 <code>.env</code> 配置 Web 服务 Key、JavaScript API Key 与 JS 安全密钥，然后重启应用。Web 服务 Key 只在后端使用。</p><a href="https://lbs.amap.com/dev/key/app" target="_blank" rel="noreferrer">前往高德开放平台<ArrowUpRight size={13} /></a></div></div><div className="guide-step"><span>02</span><div><h3>模糊愿望，真实道路</h3><p>通过周边地点和路线规划组合环线，按接近目标时长排序。时间是估算，不含停车、游玩；高架偏好不能保证全程高架。</p></div></div><div className="guide-step"><span>03</span><div><h3>手机高德 → 高德车机版</h3><p>真实路线可把起点、终点和途经点交给手机高德重新规划。手机与车机登录同一高德账号后，使用高德内的发送至车机功能；是否保留全部途经点取决于车机版本，需要实车验证。</p><p>当前没有接入公开的第三方直推车机接口。也可按路线清单逐段导航。</p></div></div><div className="guide-status"><span className={`status-dot ${config?.liveRouting ? 'connected' : ''}`} />路线 API：{config?.liveRouting ? '已配置' : '未配置'}<span className="status-separator">/</span>地图：{config?.jsKey ? '已配置' : '示意预览'}</div></>}
      {modal === 'handoff' && selected && !demo && <><span className="dialog-eyebrow">TAKE THE LONG WAY HOME</span><h2>这一圈，用高德带路。</h2><p className="dialog-intro">起点、{selected.waypoints.length} 个途经点与返回终点会传给高德 App。高德会按当前路况和本地偏好重新规划，可能与预览不同。</p><div className="app-link-buttons"><a className="primary-button" href={buildAppRouteUrl(selected, 'android')}><Navigation size={17} />Android 高德<ArrowUpRight size={15} /></a><a className="secondary-button" href={buildAppRouteUrl(selected, 'ios')}>iPhone 高德<ArrowUpRight size={15} /></a></div><p className="field-note">请在装有高德地图的手机打开。步行多途经点兼容性需真机验证，未保留时使用下面的分段导航。</p><div className="handoff-info"><CarFront size={23} /><div><h3>在高德里发送到车机</h3><p>手机与高德车机版登录同一账号。在手机高德中查找“发送至车机”。不同版本可能仅发送地点，请在车机确认途经点。</p></div></div><h3 className="legs-heading">也可以，一段一段走</h3><p className="field-note">网页版无法完整传递多个途经点，以下每个链接只规划一段。</p><div className="leg-list">{routeLegs(selected).map((leg, i) => <a key={i} href={buildLegWebUrl(selected, i)} target="_blank" rel="noreferrer"><span>{i + 1}</span><div>{leg.from.name}<ArrowRight size={12} />{leg.to.name}</div><ArrowUpRight size={14} /></a>)}</div></>}
      {modal === 'saved' && <><span className="dialog-eyebrow">YOUR LITTLE ESCAPES</span><h2>留着，下次再出发。</h2><p className="dialog-intro">收藏保存在这台设备的浏览器里。出发前记得更新路况。</p>{saved.length ? <div className="saved-list">{saved.map(route => <div className="saved-item" key={route.id}><button onClick={() => restoreRoute(route)}><span>{route.source === 'demo' ? '示意路线' : modeName(route.mode)}</span><strong>{route.name}</strong><small>{minutesOf(route)} 分钟 · {distanceOf(route)} 公里<ChevronRight size={14} /></small></button><button className="icon-button" aria-label={`删除收藏 ${route.name}`} onClick={() => toggleSaved(route)}><X size={16} /></button></div>)}</div> : <div className="empty-state"><Heart size={32} strokeWidth={1.2} /><p>还没有收藏的路线</p><span>遇见喜欢的一圈，点一下路线旁的爱心。</span></div>}</>}
    </div></dialog>
    {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
  </div>;
}
