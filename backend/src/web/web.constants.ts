import type { fetchPublicUrl } from './safe-fetch.js';

/** Injection token for the URL fetcher, so tests can replace the network with a fake. */
export const WEB_FETCH = Symbol('WEB_FETCH');

export type WebFetch = typeof fetchPublicUrl;
