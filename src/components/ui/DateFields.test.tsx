// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { DateFields } from '@/components/ui/DateFields'

afterEach(cleanup)

function ControlledDate({ min, max }: { min: string; max: string }) {
  const [date, setDate] = useState('')
  return <div><DateFields label="出生日期" value={date} onChange={setDate} min={min} max={max} /><output>{date}</output></div>
}

describe('精确日期选择', () => {
  it('输入四位年份并选择月和日，不需要逐月翻页', () => {
    render(<ControlledDate min="1900-01-01" max="2008-10-10" />)
    fireEvent.change(screen.getByRole('textbox', { name: '出生日期年份' }), { target: { value: '1992' } })
    fireEvent.change(screen.getByRole('combobox', { name: '出生日期月份' }), { target: { value: '05' } })
    fireEvent.change(screen.getByRole('combobox', { name: '出生日期日期' }), { target: { value: '12' } })
    expect(screen.getByRole('status').textContent).toBe('1992-05-12')
    expect(screen.getByText('已选择：1992 年 5 月 12 日')).toBeInTheDocument()
  })

  it('限制未成年人未来日期，正确处理闰年和大小月', () => {
    render(<ControlledDate min="1900-01-01" max="2008-10-10" />)
    fireEvent.change(screen.getByRole('textbox', { name: '出生日期年份' }), { target: { value: '2008' } })
    fireEvent.change(screen.getByRole('combobox', { name: '出生日期月份' }), { target: { value: '10' } })
    expect(screen.getByRole('option', { name: '11 日' })).toBeDisabled()
    fireEvent.change(screen.getByRole('combobox', { name: '出生日期日期' }), { target: { value: '09' } })
    expect(screen.getByRole('status').textContent).toBe('2008-10-09')
    fireEvent.change(screen.getByRole('textbox', { name: '出生日期年份' }), { target: { value: '2000' } })
    fireEvent.change(screen.getByRole('combobox', { name: '出生日期月份' }), { target: { value: '02' } })
    fireEvent.change(screen.getByRole('combobox', { name: '出生日期日期' }), { target: { value: '29' } })
    expect(screen.getByRole('status').textContent).toBe('2000-02-29')
    fireEvent.change(screen.getByRole('textbox', { name: '出生日期年份' }), { target: { value: '2001' } })
    expect(screen.getByRole('status').textContent).toBe('')
    expect(screen.getByRole('combobox', { name: '出生日期日期' })).toHaveValue('')
  })

  it('编辑表单外部恢复已保存的日期时同步回填', () => {
    const handle = vi.fn()
    function Wrapper() {
      const [value, setValue] = useState('1990-01-01')
      return (
        <>
          <DateFields label="生日" value={value} onChange={handle} />
          <button onClick={() => setValue('1998-12-25')}>恢复资料</button>
        </>
      )
    }
    render(<Wrapper />)
    fireEvent.click(screen.getByRole('button', { name: '恢复资料' }))
    expect(screen.getByRole('textbox', { name: '生日年份' })).toHaveValue('1998')
    expect(screen.getByRole('combobox', { name: '生日月份' })).toHaveValue('12')
    expect(screen.getByRole('combobox', { name: '生日日期' })).toHaveValue('25')
    expect(handle).not.toHaveBeenCalled()
  })
})
