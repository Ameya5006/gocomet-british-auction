export const MAX_CHARGE = 99999999999999n
export function cents(value: string): bigint {
  const clean = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(clean))
    throw new Error('Enter a nonnegative amount with at most two decimal places.')
  const [whole, fraction = ''] = clean.split('.')
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
}
export function decimal(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`
}
export function totalCharges(values: string[]): string {
  return decimal(values.reduce((sum, value) => sum + cents(value), 0n))
}
export function money(value: string | null): string {
  if (value === null) return 'No bids'
  const amount = cents(value)
  return `₹${(amount / 100n).toLocaleString('en-IN')}.${(amount % 100n).toString().padStart(2, '0')}`
}
export function sortBids<T extends { total: string; id: number }>(bids: T[]): T[] {
  return [...bids].sort((a, b) => {
    const difference = cents(a.total) - cents(b.total)
    return difference < 0n ? -1 : difference > 0n ? 1 : a.id - b.id
  })
}
