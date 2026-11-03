import type { City, Place } from '../../shared/types';
import { POPULAR_CITIES } from '../../shared/cities';

export const CITY_STORAGE_KEY = 'city-wander-city';

export function isCity(value: unknown): value is City {
  if (!value || typeof value !== 'object') return false;
  const city = value as Partial<City>;
  return typeof city.name === 'string' && city.name.trim().length > 0 && city.name.length <= 80
    && typeof city.adcode === 'string' && /^\d{6}$/.test(city.adcode)
    && Array.isArray(city.center) && city.center.length === 2
    && city.center.every(point => typeof point === 'number' && Number.isFinite(point))
    && Math.abs(city.center[0]) <= 180 && Math.abs(city.center[1]) <= 90;
}

export function parseRememberedCity(value: string | null): City | null {
  try {
    const city: unknown = JSON.parse(value || 'null');
    return isCity(city) ? city : null;
  } catch { return null; }
}

export function rememberedCity(city: City): City {
  // Reverse geocoding can use the selected point as a fallback center. Store a
  // canonical city center, or a coarse browsing center, never precise GPS here.
  const known = POPULAR_CITIES.find(candidate => candidate.adcode === city.adcode);
  return { name: city.name, adcode: city.adcode, center: known
    ? [...known.center]
    : [Math.round(city.center[0] * 10) / 10, Math.round(city.center[1] * 10) / 10] };
}

export function cityCenterPlace(city: City): Place {
  return { id: `city-center-${city.adcode}`, name: `${city.name}地图中心`, location: [...city.center], city,
    address: '请搜索具体地点，或在地图上选择出发位置' };
}
