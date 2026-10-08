import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { preferencesApi } from "@/api/preferences";
import { toast } from "@/lib/notify";

export const PREFERENCES_QUERY_KEY = ["me-preferences"];

/**
 * Preferências do usuário logado. `enabled: false` para quem não pode ter nenhuma opção (sem o módulo): a tela fica
 * como era, sem chamada a mais.
 */
export function usePreferences({ enabled = true } = {}) {
  const query = useQuery({
    queryKey: PREFERENCES_QUERY_KEY,
    queryFn: async () => (await preferencesApi.get())?.preferencias || {},
    enabled,
  });
  return { preferences: query.data || null, isLoading: query.isLoading && enabled, error: query.error || null, refetch: query.refetch };
}

/**
 * Liga/desliga uma preferência. A resposta do servidor substitui o cache (é o estado gravado); `invalidate` lista as
 * leituras que mudam com a opção (ex.: o resumo do Dashboard).
 */
export function useUpdatePreference({ successMessage, invalidate = [] } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }) => preferencesApi.update({ [key]: value }),
    onSuccess: async (result, variables) => {
      queryClient.setQueryData(PREFERENCES_QUERY_KEY, result?.preferencias || {});
      if (successMessage) toast.success(successMessage(variables.value));
      await Promise.all(invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
    onError: (err) => toast.error(err.message || "Não foi possível salvar a sua escolha. Tente de novo."),
  });
}
