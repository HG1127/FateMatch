import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

type DatePart = 'year' | 'month' | 'day'
interface Parts { year: string; month: string; day: string }
interface DateFieldsProps {
  label: string
  value: string
  onChange: (date: string) => void
  min?: string
  max?: string
  disabled?: boolean
}

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))
const empty: Parts = { year: '', month: '', day: '' }

function parseISO(value: string): Parts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? { year: match[1], month: match[2], day: match[3] } : { ...empty }
}

function dayCount(year: string, month: string): number {
  if (!/^\d{4}$/.test(year) || !MONTHS.includes(month)) return 31
  return new Date(Number(year), Number(month), 0).getDate()
}

function completeISO(parts: Parts, min: string, max: string): string {
  const { year, month, day } = parts
  if (!/^\d{4}$/.test(year) || !MONTHS.includes(month) || !/^\d{2}$/.test(day)) return ''
  const num = Number(day)
  if (num < 1 || num > dayCount(year, month)) return ''
  const iso = `${year}-${month}-${day}`
  return iso >= min && iso <= max ? iso : ''
}

/**
 * 年份直接输入、月份与日期使用原生触屏选择器。
 * 不使用需要逐月翻几十次的浏览器日历；仅向父表单提交完整、合法的 ISO 日期。
 */
export function DateFields({
  label, value, onChange, min = '1900-01-01', max = '2100-12-31', disabled = false,
}: DateFieldsProps) {
  const [parts, setParts] = useState<Parts>(() => parseISO(value))
  const lastReported = useRef(value)
  useEffect(() => {
    if (value === lastReported.current) return
    lastReported.current = value
    setParts(parseISO(value))
  }, [value])

  const setPart = (key: DatePart, text: string) => {
    const next: Parts = { ...parts, [key]: text }
    // 2 月 / 大小月、未成年人截止日切换后，避免保留一个不合法的“日”。
    if (key === 'year' || key === 'month') {
      const maxDay = dayCount(next.year, next.month)
      if (Number(next.day) > maxDay) next.day = ''
    }
    const iso = completeISO(next, min, max)
    if (next.day && !iso && next.year.length === 4 && next.month) next.day = ''
    setParts(next)
    lastReported.current = iso
    onChange(iso)
  }

  const validYear = /^\d{4}$/.test(parts.year)
  const yearOutOfBounds = validYear && (parts.year < min.slice(0, 4) || parts.year > max.slice(0, 4))
  const days = parts.month && validYear ? dayCount(parts.year, parts.month) : 31
  const dateLabel = completeISO(parts, min, max)
  const yearsHint = `${min.slice(0, 4)}—${max.slice(0, 4)}`

  return (
    <div role="group" aria-label={label}>
      <div className="grid min-w-0 grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2">
        <input
          className="input-cn min-w-0 text-center tabular-nums"
          aria-label={`${label}年份`}
          aria-invalid={yearOutOfBounds || undefined}
          disabled={disabled}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]{4}"
          maxLength={4}
          placeholder="年份，如 1995"
          value={parts.year}
          onChange={event => setPart('year', event.target.value.replace(/\D/g, '').slice(0, 4))}
        />
        <select
          className="input-cn min-w-0 tabular-nums"
          aria-label={`${label}月份`}
          disabled={disabled}
          value={parts.month}
          onChange={event => setPart('month', event.target.value)}
        >
          <option value="">月份</option>
          {MONTHS.map(month => <option key={month} value={month}>{Number(month)} 月</option>)}
        </select>
        <select
          className="input-cn min-w-0 tabular-nums"
          aria-label={`${label}日期`}
          disabled={disabled || !validYear || !parts.month || yearOutOfBounds}
          value={parts.day}
          onChange={event => setPart('day', event.target.value)}
        >
          <option value="">日期</option>
          {Array.from({ length: days }, (_, i) => String(i + 1).padStart(2, '0')).map(day => {
            const iso = `${parts.year}-${parts.month}-${day}`
            return <option key={day} value={day} disabled={iso < min || iso > max}>{Number(day)} 日</option>
          })}
        </select>
      </div>
      <p aria-live="polite" className={cn('mt-1.5 text-xs leading-5', yearOutOfBounds ? 'text-destructive' : 'text-muted-foreground')}>
        {yearOutOfBounds ? `请填写 ${yearsHint} 年之间的年份`
          : dateLabel ? `已选择：${parts.year} 年 ${Number(parts.month)} 月 ${Number(parts.day)} 日`
            : `直接填写 4 位年份（${yearsHint}），再选择月、日`}
      </p>
    </div>
  )
}
