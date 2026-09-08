// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CityPicker } from '@/components/ui/CityPicker'
import { buildRegion, cityToken } from '@/lib/region'

afterEach(cleanup)

/** 三个下拉依次为: 省份 / 城市 / 区县 */
function selects() {
  const all = screen.getAllByRole('combobox')
  return { prov: all[0], cty: all[1], dist: all[2] }
}

describe('CityPicker', () => {
  it('完整地区串回填三级选择', () => {
    render(<CityPicker city="杭州" region="浙江省·杭州市·西湖区" onPick={() => {}} />)
    const { prov, cty, dist } = selects()
    expect(prov).toHaveValue('浙江省')
    expect(cty).toHaveValue('杭州市')
    expect(dist).toHaveValue('西湖区')
  })

  it('直辖市两段串回填为 市辖区 中层', () => {
    render(<CityPicker city="北京" region="北京市·朝阳区" onPick={() => {}} />)
    const { prov, cty, dist } = selects()
    expect(prov).toHaveValue('北京市')
    expect(cty).toHaveValue('市辖区')
    expect(dist).toHaveValue('朝阳区')
  })

  it('仅城市标识也能反查省市', () => {
    render(<CityPicker city="杭州" onPick={() => {}} />)
    const { prov, cty } = selects()
    expect(prov).toHaveValue('浙江省')
    expect(cty).toHaveValue('杭州市')
  })

  it('未选省时城市与区县下拉禁用', () => {
    render(<CityPicker city="" onPick={() => {}} />)
    const { cty, dist } = selects()
    expect(cty).toBeDisabled()
    expect(dist).toBeDisabled()
  })

  it('级联选择逐级回传统一标识与完整地区串', () => {
    const onPick = vi.fn()
    render(<CityPicker city="" onPick={onPick} />)
    const { prov, cty, dist } = selects()

    fireEvent.change(prov, { target: { value: '浙江省' } })
    expect(onPick).toHaveBeenLastCalledWith('', buildRegion('浙江省', '', ''))
    expect(cty).not.toBeDisabled()

    fireEvent.change(cty, { target: { value: '杭州市' } })
    expect(onPick).toHaveBeenLastCalledWith(
      cityToken('杭州市', '浙江省'),
      buildRegion('浙江省', '杭州市', ''),
    )
    expect(dist).not.toBeDisabled()

    fireEvent.change(dist, { target: { value: '西湖区' } })
    expect(onPick).toHaveBeenLastCalledWith(
      cityToken('杭州市', '浙江省'),
      buildRegion('浙江省', '杭州市', '西湖区'),
    )
  })

  it('换省后清空市与区县', () => {
    const onPick = vi.fn()
    render(<CityPicker city="杭州" region="浙江省·杭州市·西湖区" onPick={onPick} />)
    const { prov, cty, dist } = selects()

    fireEvent.change(prov, { target: { value: '江苏省' } })
    expect(cty).toHaveValue('')
    expect(dist).toHaveValue('')
    expect(onPick).toHaveBeenLastCalledWith('', buildRegion('江苏省', '', ''))
  })
})
