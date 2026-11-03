import type { City } from './types.js';

// AMap administrative centres, verified with /v3/config/district on 2026-11-03.
// These are map browsing centres, never automatically selected departure points.
export const POPULAR_CITIES: City[] = [
  { name: '杭州市', adcode: '330100', center: [120.209903, 30.246566] },
  { name: '上海市', adcode: '310000', center: [121.473667, 31.230525] },
  { name: '宁波市', adcode: '330200', center: [121.62454, 29.860258] },
  { name: '苏州市', adcode: '320500', center: [120.585294, 31.299758] },
  { name: '南京市', adcode: '320100', center: [118.796624, 32.059344] },
  { name: '北京市', adcode: '110000', center: [116.407387, 39.904179] },
  { name: '广州市', adcode: '440100', center: [113.264499, 23.130061] },
  { name: '深圳市', adcode: '440300', center: [114.057939, 22.543527] },
  { name: '成都市', adcode: '510100', center: [104.066301, 30.572961] },
  { name: '重庆市', adcode: '500000', center: [106.551787, 29.56268] },
  { name: '武汉市', adcode: '420100', center: [114.304569, 30.593354] },
  { name: '西安市', adcode: '610100', center: [108.939645, 34.343207] },
];

export const DEFAULT_CITY = POPULAR_CITIES[0];
