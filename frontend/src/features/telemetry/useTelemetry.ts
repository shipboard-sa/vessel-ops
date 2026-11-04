import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../api/client'
import type { MeterStatus, TelemetrySnapshot } from '../../api/types'

export function useTelemetrySnapshot() {
  return useQuery({
    queryKey: ['telemetry-snapshot'],
    queryFn: () => apiGet<TelemetrySnapshot>('/telemetry/snapshot'),
    refetchInterval: 60_000,
  })
}

export function useMeterStatus(meter: 'engine' | 'genset') {
  return useQuery({
    queryKey: ['meter-status', meter],
    queryFn: () => apiGet<MeterStatus>(`/telemetry/${meter}/status`),
    refetchInterval: 60_000,
  })
}
