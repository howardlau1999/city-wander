import { describe, expect, it } from 'vitest';
import { createCitySearch, parseCities, parseLocationCity } from '../server/cities';
import { locationString, type AmapRequest } from '../server/amap';
import { distanceBetween, offsetLocation, planSchema, planWander } from '../server/planner';
import type { City, Coordinate, PlanRequest } from '../shared/types';

const shanghai: City = { name: '上海市', adcode: '310000', center: [121.4737, 31.2304] };
const cityRecord = { name: '苏州市', adcode: '320500', center: '120.5853,31.2989', level: 'city' };
const regeo = (component: Record<string, unknown>) => ({ regeocode: { formatted_address: '测试地点', addressComponent: component } });

describe('城市搜索与位置识别', () => {
  it('支持城市、直辖市和县级市，不把省份、城区或异常结果当作城市', () => {
    const cities = parseCities({ districts: [
      cityRecord,
      { name: '上海市', adcode: '310000', center: '121.4737,31.2304', level: 'province' },
      { name: '昆山市', adcode: '320583', center: '120.9818,31.3856', level: 'district' },
      { name: '神农架林区', adcode: '429021', center: '110.6757,31.7444', level: 'district' },
      { name: '浙江省', adcode: '330000', center: '120.15,30.27', level: 'province' },
      { name: '黄浦区', adcode: '310101', center: '121.48,31.23', level: 'district' },
      { name: '中国', adcode: '100000', center: '116.4,39.9', level: 'country' },
      { ...cityRecord, adcode: 'broken' },
      { ...cityRecord, adcode: '320501', center: '200,31' },
      cityRecord,
    ] });
    expect(cities.map(city => city.adcode)).toEqual(['320500', '310000', '320583', '429021']);
    expect(cities[1]).toEqual(shanghai);
  });

  it.each([false, true])('直辖市中间层归一并优先采用市级中心，父级先出现=%s', (parentFirst) => {
    for (const [code, name, children] of [
      ['110000', '北京市', ['北京城区', '北京郊县']],
      ['120000', '天津市', ['天津城区', '天津郊县']],
      ['310000', '上海市', ['上海城区', '上海郊县']],
      ['500000', '重庆市', ['重庆城区', '重庆郊县']],
    ] as const) {
      const parent = { adcode: code, name, center: '121.47,31.23', level: 'province' };
      const intermediate = children.map((childName, index) => ({ adcode: `${code.slice(0, 2)}0${index + 1}00`, name: childName, center: '121.5,31.3', level: 'city' }));
      const districts = parentFirst ? [parent, ...intermediate] : [...intermediate, parent];
      expect(parseCities({ districts })).toEqual([{ name, adcode: code, center: [121.47, 31.23] }]);
      expect(parseCities({ districts: intermediate })).toEqual([{ name, adcode: code, center: [121.5, 31.3] }]);
    }
  });

  it('普通城区反查得到所属城市，直辖市空 city 数组回退到直辖市', () => {
    const point: Coordinate = [104.06, 30.65];
    expect(parseLocationCity(regeo({ province: '四川省', city: '成都市', district: '锦江区', adcode: '510104' }), point)).toEqual({
      city: { name: '成都市', adcode: '510100', center: point }, address: '测试地点',
    });
    expect(parseLocationCity(regeo({ province: '上海市', city: [], district: '黄浦区', adcode: '310101' }), shanghai.center).city).toEqual(shanghai);
  });

  it('省直辖县保留县级区域，不把整个省作为当前城市', () => {
    const point: Coordinate = [113.45, 30.37];
    expect(parseLocationCity(regeo({ province: '湖北省', city: [], district: '仙桃市', adcode: '429004' }), point).city).toEqual({ name: '仙桃市', adcode: '429004', center: point });
    expect(parseLocationCity(regeo({ province: '湖北省', city: '仙桃市', district: [], adcode: '429004' }), point).city?.adcode).toBe('429004');
    expect(parseLocationCity(regeo({ province: '湖北省', city: [], district: [], adcode: '420000' }), point).city).toBeNull();
    expect(parseLocationCity(regeo({ province: '境外', city: [], district: [], adcode: [] }), point).city).toBeNull();
    expect(parseLocationCity({}, point)).toEqual({ city: null });
  });

  it('复用成功的城市查询，不缓存无结果或上游错误', async () => {
    const queries: string[] = [];
    const api: AmapRequest = async (endpoint, params) => {
      expect(endpoint).toBe('/v3/config/district');
      expect(params.subdistrict).toBe(0);
      expect(params.extensions).toBe('base');
      const query = String(params.keywords);
      queries.push(query);
      if (query === '失败') throw new Error('upstream');
      return { districts: query === '苏州' ? [cityRecord] : [] };
    };
    const search = createCitySearch(api);
    await search('苏州'); await search('苏州');
    await search('未知'); await search('未知');
    await expect(search('失败')).rejects.toThrow('upstream');
    await expect(search('失败')).rejects.toThrow('upstream');
    expect(queries).toEqual(['苏州', '未知', '未知', '失败', '失败']);
  });
});

describe('城市元数据与跨城市规划', () => {
  it('保留合法城市元数据供收藏恢复，拒绝无效区域码和坐标', () => {
    const request = { origin: { id: 'origin', name: '起点', location: shanghai.center, city: shanghai }, mode: 'driving', minutes: 60, preference: 'park', seed: 1 };
    expect(planSchema.parse(request).origin.city).toEqual(shanghai);
    expect(planSchema.safeParse({ ...request, origin: { ...request.origin, city: { ...shanghai, adcode: 'Shanghai' } } }).success).toBe(false);
    expect(planSchema.safeParse({ ...request, origin: { ...request.origin, city: { ...shanghai, center: [181, 31] } } }).success).toBe(false);
  });

  it.each([
    { name: '上海市', adcode: '310000', center: [121.4737, 31.2304] as Coordinate },
    { name: '成都市', adcode: '510100', center: [104.0665, 30.5723] as Coordinate },
  ])('$name 的路线围绕实际起点搜索并回到起点', async (city) => {
    const request: PlanRequest = { origin: { id: `origin-${city.adcode}`, name: '测试起点', location: city.center, city }, mode: 'driving', minutes: 60, preference: 'park', seed: 42 };
    let searches = 0;
    const destinations: string[] = [];
    const api: AmapRequest = async (endpoint, params) => {
      if (endpoint === '/v3/place/around') {
        const center = String(params.location).split(',').map(Number) as Coordinate;
        expect(distanceBetween(center, city.center)).toBeLessThan(30_000);
        expect(params.city).toBeUndefined();
        searches++;
        return { pois: [{ id: `p${searches}`, name: `公园${searches}`, location: offsetLocation(city.center, 5000, searches * 120).join(',') }] };
      }
      expect(endpoint).toBe('/v5/direction/driving');
      destinations.push(String(params.destination));
      return { route: { paths: [{ distance: '5000', cost: { duration: '1800' }, steps: [{ road_name: '当地道路', polyline: [params.origin, ...(params.waypoints ? [params.waypoints] : []), params.destination].join(';') }] }] } };
    };
    const result = await planWander(planSchema.parse(request), api);
    expect(result.routes).toHaveLength(3);
    expect(result.routes.every(route => route.origin.city?.adcode === city.adcode)).toBe(true);
    expect(destinations.filter(destination => destination === locationString(city.center))).toHaveLength(3);
  });
});
