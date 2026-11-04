import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiSend } from '../../api/client'

export function useSetAisleOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (categories: string[]) =>
      apiSend('PUT', '/provisioning/aisle-order', { categories }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aisle-order'] })
      queryClient.invalidateQueries({ queryKey: ['provisioning-plan'] })
    },
  })
}

export function useSetProvisioningPrefs() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (prefs: { crew: number; weeks: number }) =>
      apiSend('PUT', '/provisioning/prefs', prefs),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['provisioning-prefs'] }),
  })
}
