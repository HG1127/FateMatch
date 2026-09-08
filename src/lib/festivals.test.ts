import { describe, expect, it } from 'vitest'
import { FESTS, FEST_TEMPLATE } from '@/lib/festivals'

describe('佳节日历与活动模板', () => {
  it('日期键为 ISO 格式且可排序', () => {
    for (const d of Object.keys(FESTS)) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    const sorted = [...Object.keys(FESTS)].sort()
    expect(Object.keys(FESTS)).toEqual(sorted)
  })

  it('每个佳节都有一键活动模板', () => {
    for (const name of Object.values(FESTS)) {
      const t = FEST_TEMPLATE[name]
      expect(t, `${name} 缺模板`).toBeDefined()
      expect(t.title.length).toBeGreaterThan(0)
      expect(t.tags.length).toBeGreaterThan(0)
      expect(t.desc.length).toBeGreaterThan(0)
    }
  })

  it('模板不指向不存在的佳节', () => {
    const names = new Set(Object.values(FESTS))
    for (const name of Object.keys(FEST_TEMPLATE)) {
      expect(names.has(name), `${name} 无对应日历日期`).toBe(true)
    }
  })
})
