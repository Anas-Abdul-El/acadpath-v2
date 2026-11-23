import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { isPublicAddress } from './address-policy.js';

/** The URL is not one the server is allowed to fetch (scheme, port, or address). */
export class BlockedUrlError extends Error {
  constructor(reason: string) {
    super(`Blocked URL: ${reason}`);
    this.name = 'BlockedUrlError';
  }
}

export interface FetchedPage {
  /** Where the content finally came from, after redirects. */
  url: string;
  contentType: string;
  body: Buffer;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Defaults to isPublicAddress. Tests pass their own to reach a local server. */
  isAllowedAddress?: (ip: string) => boolean;
  /** Defaults to false: only the scheme's default port. Tests use a random port. */
  allowAnyPort?: boolean;
}

const DEFAULTS = {
  timeoutMs: 10_000,
  maxBytes: 5 * 1024 * 1024, // 5 MB, as in v1
  maxRedirects: 3,
};

/** Checks the URL itself: scheme, credentials, port, and IP literals (which skip DNS). */
function parseAllowedUrl(
  raw: string,
  isAllowedAddress: (ip: string) => boolean,
  allowAnyPort: boolean,
): URL {
  if (!URL.canParse(raw)) throw new BlockedUrlError('malformed URL');
  const url = new URL(raw);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError(`unsupported scheme ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new BlockedUrlError('credentials in the URL');
  }
  // URL drops a port that equals the scheme's default, so any port left is non-default.
  if (url.port !== '' && !allowAnyPort) {
    throw new BlockedUrlError(`non-default port ${url.port}`);
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !isAllowedAddress(host)) {
    throw new BlockedUrlError(`address ${host} is not public`);
  }
  return url;
}

/**
 * A DNS lookup that refuses to return a non-public address. It runs when the socket
 * connects, so the address checked is the address used. Resolving first and fetching
 * after would leave a gap for DNS rebinding (a second, different answer).
 */
function guardedLookup(
  isAllowedAddress: (ip: string) => boolean,
): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(
      hostname,
      { ...options, all: true },
      (error, addresses: LookupAddress[]) => {
        if (error) return callback(error, '', 0);

        const blocked = addresses.find(
          ({ address }) => !isAllowedAddress(address),
        );
        if (blocked || addresses.length === 0) {
          return callback(
            new BlockedUrlError(`${hostname} resolves to a non-public address`),
            '',
            0,
          );
        }
        if (options.all) return callback(null, addresses);
        const [first] = addresses;
        return callback(null, first.address, first.family);
      },
    );
  };
}

type Response =
  | { kind: 'redirect'; location: string }
  | { kind: 'page'; contentType: string; body: Buffer };

function requestOnce(
  url: URL,
  { timeoutMs, maxBytes }: { timeoutMs: number; maxBytes: number },
  lookup: LookupFunction,
): Promise<Response> {
  const client = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.get(
      url,
      {
        // A fresh agent per request, so `lookup` runs for this connection instead of a
        // pooled socket opened earlier.
        agent: false,
        lookup,
        headers: {
          'User-Agent': 'AcadPathBot/1.0',
          Accept: 'text/html,application/pdf;q=0.9,*/*;q=0.1',
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location) {
          response.resume();
          resolve({ kind: 'redirect', location });
          return;
        }
        if (status >= 400 || status < 200) {
          response.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }

        const tooLarge = () => {
          tooBig = true;
          reject(new Error(`Response is larger than ${maxBytes} bytes`));
          request.destroy();
        };
        let tooBig = false;

        // Refuse early when the server announces the size...
        if (Number(response.headers['content-length']) > maxBytes) {
          tooLarge();
          return;
        }

        // ...and count the bytes anyway, since the header can be missing or wrong.
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          if (tooBig) return;
          size += chunk.length;
          if (size > maxBytes) {
            tooLarge();
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (tooBig) return;
          resolve({
            kind: 'page',
            contentType: response.headers['content-type'] ?? '',
            body: Buffer.concat(chunks),
          });
        });
        response.on('error', reject);
      },
    );

    // One deadline for the whole exchange, body included.
    const timer = setTimeout(() => {
      request.destroy(new Error(`Request to ${url.host} timed out`));
    }, timeoutMs);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
  });
}

/**
 * Fetches a URL that came from outside the server (an AI reply, a user) without letting
 * it reach internal services. Every redirect hop goes through the same checks.
 */
export async function fetchPublicUrl(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<FetchedPage> {
  const isAllowedAddress = options.isAllowedAddress ?? isPublicAddress;
  const allowAnyPort = options.allowAnyPort ?? false;
  const limits = {
    timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
    maxBytes: options.maxBytes ?? DEFAULTS.maxBytes,
  };
  const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;
  const lookup = guardedLookup(isAllowedAddress);

  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = parseAllowedUrl(current, isAllowedAddress, allowAnyPort);
    const response = await requestOnce(url, limits, lookup);
    if (response.kind === 'page') {
      return {
        url: url.toString(),
        contentType: response.contentType,
        body: response.body,
      };
    }
    current = new URL(response.location, url).toString();
  }
  throw new Error('Too many redirects');
}
