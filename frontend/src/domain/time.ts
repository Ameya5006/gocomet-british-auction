export const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
export function localInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
export function localToUtc(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error('Enter a valid local date and time.')
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || localInput(date) !== value)
    throw new Error('This local time does not exist. Choose another time.')
  return date.toISOString()
}
export function calendarDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Enter a calendar date.')
  const date = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new Error('Enter a valid calendar date.')
  return value
}
export function timestamp(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(value))
}
export function estimatedNow(serverNow: string, receivedAt: number, tick: number): number {
  return Date.parse(serverNow) + Math.max(0, tick - receivedAt)
}
export function countdown(target: string, now: number): string {
  const seconds = Math.max(0, Math.ceil((Date.parse(target) - now) / 1000))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${days ? `${days}d ` : ''}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
