import { compact, niceTop } from './BarChart'
import { addDays, money, perDay, rangeProblem } from './common'
import { percent, toBps } from './MoneySection'
import { versionRows } from './VersionsSection'

describe('analytics helpers', () => {
  it('rounds the axis top to 1, 2 or 5 times a power of ten', () => {
    expect(niceTop(0)).toBe(0)
    expect(niceTop(7)).toBe(10)
    expect(niceTop(130)).toBe(200)
    expect(niceTop(4_900)).toBe(5_000)
    expect(compact(9_999)).toBe('9,999')
    expect(compact(12_500)).toBe('12.5K')
    expect(compact(2_50_000)).toBe('2.5L')
  })

  it('writes rupees the Indian way from paise', () => {
    expect(money(1_23_45_600)).toBe('₹1,23,456')
    expect(money(1_250)).toBe('₹12.50')
    expect(money(-50_000)).toBe('−₹500')
  })

  it('reads a fee rate as basis points, 0 to 30%', () => {
    expect(toBps('15')).toBe(1500)
    expect(toBps('11,5')).toBe(1150)
    expect(toBps('0')).toBe(0)
    expect(toBps('30.01')).toBeNull()
    expect(toBps('abc')).toBeNull()
    expect(toBps('')).toBeNull()
    expect(percent(1250)).toBe('12.5')
  })

  it('fills every day of the range, and refuses a range the backend would', () => {
    const r = { from: '2026-11-28', to: '2026-12-01' }
    expect(perDay([{ day: '2026-11-30', dim: 'CUSTOMER', value: 3 }, { day: '2026-11-30', dim: 'ADMIN', value: 9 }], r, (d) => d !== 'ADMIN')).toEqual([
      { day: '2026-11-28', value: 0 },
      { day: '2026-11-29', value: 0 },
      { day: '2026-11-30', value: 3 },
      { day: '2026-12-01', value: 0 },
    ])
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(rangeProblem({ from: '2026-11-02', to: '2026-11-01' }, '2026-11-25')).toMatch(/after the last/)
    expect(rangeProblem({ from: '2026-11-01', to: '2026-11-26' }, '2026-11-25')).toMatch(/future/)
    expect(rangeProblem({ from: '2025-01-01', to: '2026-11-25' }, '2026-11-25')).toMatch(/a year/)
    expect(rangeProblem({ from: '2025-11-25', to: '2026-11-25' }, '2026-11-25')).toBeNull()
  })

  it('lists app versions Play Store first, newest first, with today, yesterday and the busiest day', () => {
    const rows = versionRows(
      {
        today: '2026-11-25',
        days: [
          { day: '2026-11-25', app: 'partner', versionCode: 240, store: true, phones: 4 },
          { day: '2026-11-24', app: 'partner', versionCode: 245, store: true, phones: 90 },
          { day: '2026-11-20', app: 'partner', versionCode: 245, store: true, phones: 110 },
          { day: '2026-11-25', app: 'partner', versionCode: 246, store: false, phones: 1 },
          { day: '2026-11-25', app: 'customer', versionCode: 30, store: true, phones: 7 },
        ],
      },
      'partner',
    )
    expect(rows).toEqual([
      { versionCode: 245, store: true, today: 0, yesterday: 90, peak: 110 },
      { versionCode: 240, store: true, today: 4, yesterday: 0, peak: 4 },
      { versionCode: 246, store: false, today: 1, yesterday: 0, peak: 1 },
    ])
  })
})
