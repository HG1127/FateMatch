import { describe, expect, it } from 'vitest'
import { ALL_CITIES, buildRegion, cityToken, districtOf, districtsOf, provinceOfCity, regionOf } from '@/lib/region'

describe('cityToken 统一城市标识', () => {
  it('直辖市中层为市辖区时取省名', () => {
    expect(cityToken('市辖区', '北京市')).toBe('北京')
  })
  it('地级市去掉「市」后缀', () => {
    expect(cityToken('杭州市', '浙江省')).toBe('杭州')
  })
  it('中层与省同名时原样取省名(防御分支)', () => {
    expect(cityToken('浙江省', '浙江省')).toBe('浙江省')
  })
})

describe('buildRegion 地区串', () => {
  it('普通省份三段拼接', () => {
    expect(buildRegion('浙江省', '杭州市', '西湖区')).toBe('浙江省·杭州市·西湖区')
  })
  it('直辖市跳过市辖区中层', () => {
    expect(buildRegion('北京市', '市辖区', '朝阳区')).toBe('北京市·朝阳区')
  })
  it('空省份返回空串', () => {
    expect(buildRegion('', '', '')).toBe('')
  })
})

describe('地区解析与反查', () => {
  it('regionOf 未填完整地区时退回城市', () => {
    expect(regionOf({ city: '杭州' })).toBe('杭州')
    expect(regionOf({ city: '杭州', region: '浙江省·杭州市·西湖区' })).toBe('浙江省·杭州市·西湖区')
  })
  it('districtOf 与地区串解析规则一致', () => {
    expect(districtOf({ region: '浙江省·杭州市·西湖区' })).toBe('西湖区')
    expect(districtOf({ region: '北京市·朝阳区' })).toBe('朝阳区')
    expect(districtOf({})).toBe('')
  })
  it('杭州可反查省份且有区县列表', () => {
    expect(provinceOfCity('杭州')).toBe('浙江省')
    expect(districtsOf('杭州')).toContain('西湖区')
  })
  it('未收录城市返回空且不报错', () => {
    expect(provinceOfCity('')).toBe('')
    expect(districtsOf('不存在市')).toEqual([])
  })
  it('城市标识列表去重且含主要城市', () => {
    expect(new Set(ALL_CITIES).size).toBe(ALL_CITIES.length)
    expect(ALL_CITIES).toContain('北京')
    expect(ALL_CITIES).toContain('杭州')
  })
})
