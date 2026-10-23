import type {
  BidInput,
  BidReceipt,
  RFQDetail,
  RFQInput,
  RFQList,
  Snapshot,
  Supplier,
} from './types'

const base = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code = 'network_error',
    public fields: Record<string, string> = {},
    public uncertain = false,
  ) {
    super(message)
  }
}

async function request<T>(path: string, body?: object): Promise<T> {
  const writing = body !== undefined
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      method: writing ? 'POST' : 'GET',
      headers: writing ? { 'Content-Type': 'application/json' } : undefined,
      body: writing ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new ApiError(
      writing
        ? 'The response was lost. Acceptance is uncertain. Refresh saved data and check for your submission before trying again.'
        : 'Cannot reach the auction service. Check your connection and that the API is running.',
      0,
      'network_error',
      {},
      writing,
    )
  }
  let data
  try {
    data = await response.json()
  } catch {
    throw new ApiError(
      'The service returned an unreadable response. Refresh saved data before trying again.',
      response.status,
      'invalid_response',
      {},
      writing,
    )
  }
  if (!response.ok) {
    const error = data.error
    const fields: Record<string, string> = {}
    for (const item of error?.fields ?? []) fields[item.field.replace(/^body\./, '')] = item.message
    throw new ApiError(
      error?.message || 'The request could not be completed.',
      response.status,
      error?.code || 'service_error',
      fields,
      writing && response.status >= 500,
    )
  }
  return data as T
}
async function snapshot<T>(path: string): Promise<Snapshot<T>> {
  const value = await request<T>(path)
  return { value, receivedAt: performance.now() }
}
export const api = {
  health: () => snapshot<{ status: 'ok'; database: 'ok'; server_now: string }>('/health'),
  list: () => snapshot<RFQList>('/rfqs'),
  detail: (id: string) => snapshot<RFQDetail>(`/rfqs/${encodeURIComponent(id)}`),
  suppliers: () => request<Supplier[]>('/suppliers'),
  create: (data: RFQInput) => request<RFQDetail>('/rfqs', data),
  bid: (id: number, data: BidInput) => request<BidReceipt>(`/rfqs/${id}/bids`, data),
}
