export type Trigger = 'any_bid' | 'any_rank_change' | 'l1_change'
export type AuctionStatus = 'Active' | 'Closed' | 'Force Closed'
export interface Supplier {
  id: number
  name: string
}
export interface BidInput {
  supplier_id: number
  carrier: string
  freight: string
  origin: string
  destination: string
  transit_hours: number
  valid_until: string
}
export interface Bid extends BidInput {
  id: number
  rfq_id: number
  total: string
  accepted_at: string
}
export interface RFQInput {
  name: string
  reference: string
  british_auction: true
  bid_start: string
  initial_close: string
  forced_close: string
  pickup_date: string
  window_minutes: number
  extension_minutes: number
  trigger: Trigger
}
export interface RFQ extends RFQInput {
  id: number
  currency: 'INR'
  current_close: string
  created_at: string
  lowest_bid: string | null
  status: AuctionStatus
  not_started: boolean
  server_now: string
}
export interface Activity {
  id: number
  rfq_id: number
  bid_id: number
  kind: 'bid_accepted' | 'extended'
  reason: Trigger | null
  old_close: string | null
  new_close: string | null
  occurred_at: string
}
export interface RFQDetail extends RFQ {
  ranked_quotes: { rank: number; rank_label: string; supplier: Supplier; quote: Bid }[]
  bid_history: Bid[]
  activities: Activity[]
}
export interface RFQList {
  items: RFQ[]
  server_now: string
}
export interface BidReceipt {
  bid: Bid
  current_close: string
  extended: boolean
  extension_reason: Trigger | null
  server_now: string
}
export interface Snapshot<T> {
  value: T
  receivedAt: number
}
