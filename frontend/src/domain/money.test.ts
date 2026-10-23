import { describe, expect, it } from 'vitest'
import { cents, decimal, MAX_CHARGE, money, sortBids, totalCharges } from './money'

describe('exact money', () => {
  it('adds decimal amounts without binary rounding', () =>
    expect(totalCharges(['0.10', '0.20', '0.30'])).toBe('0.60'))
  it('adds maximum charges without loss of precision', () =>
    expect(totalCharges(['999999999999.99', '999999999999.99', '999999999999.99'])).toBe(
      '2999999999999.97',
    ))
  it('normalizes decimal strings and integer inputs', () => {
    expect(decimal(cents('0012.1'))).toBe('12.10')
    expect(cents('999999999999.99')).toBe(MAX_CHARGE)
  })
  it.each(['-1', '0.001', '1.000', 'NaN', 'Infinity', '1e3', '', '.', '1,000'])(
    'rejects %s',
    (value) => expect(() => cents(value)).toThrow(),
  )
  it('formats grouped INR without converting money to Number', () =>
    expect(money('123456.70')).toBe('₹1,23,456.70'))
  it('sorts history by total then sequence without mutating it', () => {
    const bids = [
      { id: 3, total: '10.00' },
      { id: 2, total: '9.99' },
      { id: 1, total: '10.00' },
    ]
    expect(sortBids(bids).map((b) => b.id)).toEqual([2, 1, 3])
    expect(bids[0].id).toBe(3)
  })
})
