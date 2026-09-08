import pca from 'china-division/dist/pca.json'

/** 全国行政区划: 省/直辖市 → 市 → 区县, 共 31 省 340+ 市 2900+ 区县 */
export interface ProvinceNode {
  name: string
  cities: { name: string; areas: string[] }[]
}

export const PROVINCES: ProvinceNode[] = Object.entries(pca as Record<string, Record<string, string[]>>).map(
  ([name, cities]) => ({
    name,
    cities: Object.entries(cities).map(([cname, areas]) => ({ name: cname, areas })),
  }),
)

/** 统一的城市标识: 直辖市中层为「市辖区」, 取其省名; 其余地级市去掉「市」后缀, 如 杭州市 → 杭州 */
export function cityToken(cityName: string, provinceName: string): string {
  if (cityName === '市辖区' || cityName === provinceName) return provinceName.replace(/市$/, '')
  return cityName.replace(/市$/, '')
}

/** 拼出展示用的完整地区: 浙江省·杭州市·西湖区; 直辖市为 北京市·朝阳区 */
export function buildRegion(province: string, city: string, district: string): string {
  if (!province) return ''
  const parts = city === '市辖区' ? [province, district] : [province, city, district]
  return parts.filter(Boolean).join('·')
}

/** 展示用户所在地区, 未填区县时退回城市 */
export function regionOf(u: { city: string; region?: string }): string {
  return u.region || u.city
}

/** 某城市下的区县列表, 如 杭州 → ['西湖区','上城区',...]; 未收录时返回空 */
export function districtsOf(city: string): string[] {
  for (const p of PROVINCES) for (const c of p.cities) if (cityToken(c.name, p.name) === city) return c.areas
  return []
}

/** 用户所填的区县(与地区串解析规则一致), 未填时为空 */
export function districtOf(u: { region?: string }): string {
  if (!u.region) return ''
  const parts = u.region.split('·')
  if (parts.length >= 3) return parts[2]
  if (parts.length === 2 && parts[0].endsWith('市')) return parts[1] // 直辖市: 北京市·朝阳区
  return ''
}

/** 全国城市的统一标识列表, 用于筛选与匹配 */
export const ALL_CITIES: string[] = (() => {
  const set = new Set<string>()
  for (const p of PROVINCES) for (const c of p.cities) set.add(cityToken(c.name, p.name))
  return [...set]
})()

/** 由城市标识反查省份, 如 杭州 → 浙江省 */
export function provinceOfCity(city: string): string {
  if (!city) return ''
  for (const p of PROVINCES) for (const c of p.cities) if (cityToken(c.name, p.name) === city) return p.name
  return ''
}

/** 由城市标识反查原始市名, 如 杭州 → 杭州市; 直辖市为 市辖区 */
export function rawCityOf(city: string): string {
  if (!city) return ''
  for (const p of PROVINCES) for (const c of p.cities) if (cityToken(c.name, p.name) === city) return c.name
  return ''
}

/** 去掉行政区后缀, 用于模糊匹配: 浙江省 → 浙江, 杭州市 → 杭州 */
function normRegion(n: string): string {
  return n.replace(/(维吾尔自治区|壮族自治区|回族自治区|特别行政区|自治区|省|市)$/, '')
}

export interface LocatedRegion {
  prov: string
  cty: string
  dist: string
}

/** 浏览器定位 + 免费逆地理编码, 解析为省/市/区县; 失败时抛错, 由调用方提示手动选择 */
export async function locateRegion(): Promise<LocatedRegion> {
  if (!navigator.geolocation) throw new Error('no-geo')
  const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 300_000 }),
  )
  const { latitude, longitude } = pos.coords
  const res = await fetch(
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=zh`,
  )
  if (!res.ok) throw new Error('geocode-failed')
  const j = (await res.json()) as { principalSubdivision?: string; city?: string; localities?: { name: string }[] }
  const provNode = PROVINCES.find(
    p => j.principalSubdivision && (p.name === j.principalSubdivision || normRegion(p.name) === normRegion(j.principalSubdivision)),
  )
  if (!provNode) throw new Error('not-in-data')
  const cityRaw = j.city ?? ''
  const ctyNode =
    provNode.cities.find(c => c.name === cityRaw || (cityRaw && normRegion(c.name) === normRegion(cityRaw))) ??
    (provNode.cities.length === 1 ? provNode.cities[0] : undefined)
  const distRaw = j.localities?.[0]?.name ?? ''
  const dist = ctyNode?.areas.find(a => a === distRaw || (distRaw && (a.includes(distRaw) || distRaw.includes(a)))) ?? ''
  return { prov: provNode.name, cty: ctyNode?.name ?? '', dist }
}
