import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiSend } from '../../api/client'

export function useSetHoursReading() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ meter, hours }: { meter: 'engine' | 'genset'; hours: number }) =>
      apiSend('PUT', `/telemetry/${meter}/reading`, { hours }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meter-status'] })
      queryClient.invalidateQueries({ queryKey: ['telemetry-snapshot'] })
      // hours feed the hrs-interval schedule projection too.
      queryClient.invalidateQueries({ queryKey: ['schedule'] })
    },
  })
}
