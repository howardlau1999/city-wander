import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, MapPin, Search } from 'lucide-react';
import type { City } from '../../shared/types';
import { POPULAR_CITIES } from '../../shared/cities';
import { isCity } from '../lib/city-state';
import './city-picker.css';

interface Props { city: City | null; liveSearch: boolean; onSelect: (city: City) => void }

export default function CityPicker({ city, liveSearch, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<City[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const search = query.trim();
  const popularMatches = POPULAR_CITIES.filter(candidate => candidate.name.includes(search) || candidate.adcode === search);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    setResults([]); setError(''); setLoading(false);
    if (!search || !liveSearch) return;
    const controller = new AbortController(); requestRef.current = controller;
    const requestRevision = revision.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      if (controller.signal.aborted || requestRevision !== revision.current) return;
      try {
        const response = await fetch(`/api/cities?query=${encodeURIComponent(search)}`, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || '城市搜索暂时不可用，请稍后再试。');
        if (controller.signal.aborted || requestRevision !== revision.current) return;
        setResults(Array.isArray(body.cities) ? body.cities.filter(isCity) : []);
      } catch (error) {
        if (!controller.signal.aborted && requestRevision === revision.current) setError(error instanceof Error ? error.message : '城市搜索失败，请重试。');
      } finally { if (!controller.signal.aborted && requestRevision === revision.current) setLoading(false); }
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, liveSearch]);

  const cities = search ? [...popularMatches, ...results.filter(result => !popularMatches.some(popular => popular.adcode === result.adcode))] : POPULAR_CITIES;
  return <div className="city-picker">
    <span className="dialog-eyebrow">A DIFFERENT CITY, A NEW DETOUR</span>
    <h2>这次，去哪个城市？</h2>
    <p className="dialog-intro">选择城市后，再选具体出发地点。定位或地图选点也会自动识别所在城市。</p>
    <label className="city-search" htmlFor="city-search"><Search size={17} /><input id="city-search" ref={inputRef} value={query} autoComplete="off" placeholder="输入中文城市名，如苏州、厦门" onChange={event => { revision.current += 1; requestRef.current?.abort(); setResults([]); setError(''); setLoading(false); setQuery(event.target.value); }} />{loading && <LoaderCircle size={16} className="spin" />}</label>
    <div className="city-picker-heading"><span>{search ? '匹配城市' : '常用城市'}</span>{city && <span>当前 · {city.name}</span>}</div>
    <div className="city-options" aria-label="可选城市">{cities.map(candidate => <button key={candidate.adcode} className={city?.adcode === candidate.adcode ? 'selected' : ''} onClick={() => { revision.current += 1; requestRef.current?.abort(); onSelect(candidate); }}><MapPin size={14} /><span>{candidate.name}</span>{city?.adcode === candidate.adcode && <Check size={13} />}</button>)}</div>
    {error && <p className="city-picker-error" role="alert">{error}</p>}
    {search && !loading && !error && !cities.length && <p className="city-picker-empty">{liveSearch ? '没有找到城市，请输入完整中文城市名；普通省份不能作为出发城市。' : '连接高德后可以搜索更多城市。'}</p>}
    <p className="city-picker-note">{liveSearch ? '支持高德可查询的城市、直辖市和部分省直辖县级市。' : '常用城市可直接切换；真实地点搜索和路线规划需要连接高德。'}切换后会清空当前起点和路线，收藏仍会保留。</p>
  </div>;
}
