import { afterEach, expect, it, vi } from 'vitest'
import { api, ApiError } from './client'

afterEach(() => vi.unstubAllGlobals())
const bid = {
  supplier_id: 1,
  carrier: 'Carrier',
  freight: '0.10',
  origin: '0.20',
  destination: '0.30',
  transit_hours: 24,
  valid_until: '2030-01-01',
}
it('sends decimal strings and never retries a lost POST response', async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError('offline'))
  vi.stubGlobal('fetch', fetcher)
  await expect(api.bid(1, bid)).rejects.toMatchObject({ uncertain: true, status: 0 })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(bid)
})
it('maps backend field errors without marking rejection uncertain', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'validation_error',
            message: 'Invalid request',
            fields: [{ field: 'body.freight', message: 'Invalid amount' }],
          },
        }),
        { status: 422 },
      ),
    ),
  )
  await expect(api.bid(1, bid)).rejects.toMatchObject({
    fields: { freight: 'Invalid amount' },
    uncertain: false,
  })
})
it('treats unreadable POST responses as uncertain', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unreadable', { status: 200 })))
  await expect(api.bid(1, bid)).rejects.toBeInstanceOf(ApiError)
})
