import { afterEach, describe, expect, it, vi } from 'vitest'
import { calendarDate, countdown, estimatedNow, localInput, localToUtc } from './time'

afterEach(() => vi.unstubAllEnvs())
describe('time and calendar conversion', () => {
  it('converts Kolkata local time explicitly across a UTC date boundary', () => {
    vi.stubEnv('TZ', 'Asia/Kolkata')
    expect(localToUtc('2030-01-02T01:00')).toBe('2030-01-01T19:30:00.000Z')
    expect(localInput(new Date('2030-01-01T19:30:00Z'))).toBe('2030-01-02T01:00')
  })
  it('rejects a nonexistent DST local time', () => {
    vi.stubEnv('TZ', 'America/New_York')
    expect(() => localToUtc('2030-03-10T02:30')).toThrow()
  })
  it.each(['2030-02-30T12:00', 'invalid', '2030-01-01T25:00', '2030-01-01T12:00Z'])(
    'rejects invalid local input %s',
    (input) => expect(() => localToUtc(input)).toThrow(),
  )
  it('leaves calendar dates unchanged regardless of timezone', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    expect(calendarDate('2030-01-01')).toBe('2030-01-01')
  })
  it.each(['2030-02-29', '2030-02-30', '2030-13-01', '2030-1-1'])(
    'rejects invalid calendar date %s',
    (input) => expect(() => calendarDate(input)).toThrow(),
  )
  it('uses monotonic elapsed time from the server sample', () => {
    expect(estimatedNow('2030-01-01T00:00:00Z', 500, 1500)).toBe(Date.parse('2030-01-01T00:00:01Z'))
    expect(estimatedNow('2030-01-01T00:00:00Z', 500, 400)).toBe(Date.parse('2030-01-01T00:00:00Z'))
  })
  it('clamps elapsed countdowns and renders days', () => {
    expect(countdown('2030-01-01T00:00:00Z', Date.parse('2030-01-02T00:00:00Z'))).toBe('00:00:00')
    expect(countdown('2030-01-02T02:03:04Z', Date.parse('2030-01-01T00:00:00Z'))).toBe(
      '1d 02:03:04',
    )
  })
})
