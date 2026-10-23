import type { Trigger } from '../api/types'
export const triggers: Record<Trigger, { label: string; description: string; reason: string }> = {
  any_bid: {
    label: 'Any new bid',
    description: 'Extend when any bid is accepted in the closing window.',
    reason: 'A bid was accepted in the closing window.',
  },
  any_rank_change: {
    label: 'Any supplier rank change',
    description: 'Extend when a supplier changes rank or joins the ranked set.',
    reason: 'The supplier rankings changed in the closing window.',
  },
  l1_change: {
    label: 'Lowest bidder changes',
    description: 'Extend only when a different supplier becomes L1, including the first bidder.',
    reason: 'The lowest bidder changed in the closing window.',
  },
}
export function positiveInteger(value: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 2147483647)
    throw new Error('Enter a positive whole number up to 2,147,483,647.')
  return Number(value)
}
