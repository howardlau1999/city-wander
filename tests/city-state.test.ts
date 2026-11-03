import { describe, expect, it } from 'vitest';
import { cityCenterPlace, isCity, parseRememberedCity, rememberedCity } from '../src/lib/city-state';
import { DEFAULT_CITY } from '../shared/cities';

describe('remembered city safety', () => {
  it('rejects malformed storage, invalid codes and impossible coordinates', () => {
    expect(parseRememberedCity('{broken')).toBeNull();
    expect(parseRememberedCity('null')).toBeNull();
    expect(isCity({ ...DEFAULT_CITY, adcode: '../api' })).toBe(false);
    expect(isCity({ ...DEFAULT_CITY, center: [120, 100] })).toBe(false);
    expect(isCity({ ...DEFAULT_CITY, center: ['120', 30] })).toBe(false);
    expect(isCity({ ...DEFAULT_CITY, center: [120, 30, 3] })).toBe(false);
    expect(parseRememberedCity(JSON.stringify(DEFAULT_CITY))).toEqual(DEFAULT_CITY);
  });
  it('never persists a precise GPS point as a remembered city center', () => {
    expect(rememberedCity({ ...DEFAULT_CITY, center: [120.234567, 30.345678] }).center).toEqual(DEFAULT_CITY.center);
    expect(rememberedCity({ name: '测试市', adcode: '999900', center: [118.123456, 24.654321] }).center).toEqual([118.1, 24.7]);
  });
  it('labels a city center as a map location requiring an actual departure', () => {
    const place = cityCenterPlace(DEFAULT_CITY);
    expect(place.id).toBe(`city-center-${DEFAULT_CITY.adcode}`);
    expect(place.address).toContain('选择出发位置');
    expect(place.location).toEqual(DEFAULT_CITY.center);
    expect(place.location).not.toBe(DEFAULT_CITY.center);
  });
});
