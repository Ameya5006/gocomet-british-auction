import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { Snapshot } from './types'
import { estimatedNow } from '../domain/time'

export function useAuctions() {
  return useQuery({
    queryKey: ['rfqs'],
    queryFn: api.list,
    refetchInterval: (query) =>
      query.state.data?.value.items.some((r) => r.status === 'Active') ? 5000 : false,
  })
}
export function useAuction(id: string) {
  return useQuery({
    queryKey: ['rfq', id],
    queryFn: () => api.detail(id),
    refetchInterval: (query) => (query.state.data?.value.status === 'Active' ? 5000 : false),
  })
}
export function useServerNow(snapshot?: Snapshot<{ server_now: string }>) {
  const [tick, setTick] = useState(() => performance.now())
  useEffect(() => {
    const timer = setInterval(() => setTick(performance.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return snapshot ? estimatedNow(snapshot.value.server_now, snapshot.receivedAt, tick) : null
}
export function useBoundaryRefresh(
  snapshot: Snapshot<{ server_now: string }> | undefined,
  boundaries: string[],
  refetch: () => unknown,
) {
  const key = boundaries.join(',')
  useEffect(() => {
    if (!snapshot) return
    const now = estimatedNow(snapshot.value.server_now, snapshot.receivedAt, performance.now())
    const next = key
      .split(',')
      .map(Date.parse)
      .filter((t) => t > now)
      .sort((a, b) => a - b)[0]
    if (!next) return
    const timer = setTimeout(
      () => {
        void refetch()
      },
      Math.min(next - now + 150, 2147483647),
    )
    return () => clearTimeout(timer)
  }, [snapshot, key, refetch])
}
