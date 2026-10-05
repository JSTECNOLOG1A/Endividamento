import { QueryClient } from '@tanstack/react-query';

/** Novas tentativas padrão de uma leitura que falhou. */
export const DEFAULT_QUERY_RETRIES = 1;


export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: DEFAULT_QUERY_RETRIES,
		},
	},
});