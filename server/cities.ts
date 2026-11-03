import type { City, Coordinate } from '../shared/types.js';
import { array, coordinate, locationString, object, string, type AmapRequest } from './amap.js';

const MUNICIPALITIES: Record<string, string> = { '110000': '北京市', '120000': '天津市', '310000': '上海市', '500000': '重庆市' };
const isAdcode = (value: string) => /^[1-9]\d{5}$/.test(value);
const isDirectCounty = (adcode: string) => /^(4190|4290|4690|6590)\d{2}$/.test(adcode) && !adcode.endsWith('00');

// Administrative centres are for browsing the map, not confirmed route origins.
export function parseCities(data: unknown): City[] {
  const cities = new Map<string, City>();
  for (const value of array(object(data).districts)) {
    const district = object(value);
    const adcode = string(district.adcode), name = string(district.name).trim();
    const center = coordinate(district.center), level = string(district.level);
    const isMunicipalityParent = level === 'province' && MUNICIPALITIES[adcode] === name;
    const supported = level === 'city'
      || isMunicipalityParent
      || (level === 'district' && (name.endsWith('市') || isDirectCounty(adcode)));
    if (!supported || !isAdcode(adcode) || !name || name.length > 60 || !center) continue;
    // AMap may also return 上海城区 / 重庆城区 / 重庆郊县 at the city level.
    // They belong to the same municipality; prefer its parent centre in either order.
    const municipalityCode = `${adcode.slice(0, 2)}0000`;
    const isMunicipalityChild = level === 'city' && Boolean(MUNICIPALITIES[municipalityCode]);
    const canonicalCode = isMunicipalityChild ? municipalityCode : adcode;
    const canonicalName = isMunicipalityChild ? MUNICIPALITIES[municipalityCode] : name;
    if (!cities.has(canonicalCode) || isMunicipalityParent) cities.set(canonicalCode, { name: canonicalName, adcode: canonicalCode, center });
  }
  return [...cities.values()];
}

export function parseLocationCity(data: unknown, location: Coordinate): { city: City | null; address?: string } {
  const regeo = object(object(data).regeocode);
  const component = object(regeo.addressComponent);
  const adcode = string(component.adcode);
  const province = string(component.province).trim(), city = string(component.city).trim(), district = string(component.district).trim();
  const address = string(regeo.formatted_address).trim();
  const result = { city: null as City | null, ...(address ? { address } : {}) };
  if (!isAdcode(adcode)) return result;

  const provinceCode = `${adcode.slice(0, 2)}0000`;
  let name = '', cityCode = '';
  if (MUNICIPALITIES[provinceCode] && MUNICIPALITIES[provinceCode] === province) {
    name = province; cityCode = provinceCode;
  } else if (isDirectCounty(adcode) && (district || city)) {
    name = district || city; cityCode = adcode;
  } else if (city && !adcode.endsWith('0000')) {
    name = city; cityCode = `${adcode.slice(0, 4)}00`;
  }
  if (name && name.length <= 60) result.city = { name, adcode: cityCode, center: [...location] };
  return result;
}

export function createCitySearch(api: AmapRequest) {
  const cache = new Map<string, { expires: number; cities: City[] }>();
  return async (query: string): Promise<City[]> => {
    const cached = cache.get(query);
    if (cached && cached.expires > Date.now()) return cached.cities;
    cache.delete(query);
    const cities = parseCities(await api('/v3/config/district', { keywords: query, subdistrict: 0, extensions: 'base' }));
    if (cities.length) {
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(query, { expires: Date.now() + 24 * 60 * 60 * 1000, cities });
    }
    return cities;
  };
}

export async function lookupLocationCity(api: AmapRequest, location: Coordinate) {
  const data = await api('/v3/geocode/regeo', { location: locationString(location), extensions: 'base' });
  return parseLocationCity(data, location);
}
