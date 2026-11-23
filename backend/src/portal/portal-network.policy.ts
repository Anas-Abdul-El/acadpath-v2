import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BrowserContext, BrowserContextOptions } from 'playwright';
import {
  parseList,
  type EnvironmentVariables,
} from '../config/env.validation.js';
import { isPublicAddress } from '../web/address-policy.js';

/** Optional override of the address check, for tests that need a local server. */
export const PORTAL_ADDRESS_CHECK = Symbol('PORTAL_ADDRESS_CHECK');

/** DNS answers are cached briefly so pages with many resources stay fast. */
const DNS_TTL_MS = 60_000;
const RESERVED_NAMES = /(^|\.)(localhost|internal|local)$/i;

const parseHttpUrl = (raw: string): URL | null =>
  URL.canParse(raw) && /^https?:$/.test(new URL(raw).protocol)
    ? new URL(raw)
    : null;

/** Headers that describe the original body, or the redirect itself: dropped on rewrite. */
const BODY_HEADERS = new Set([
  'location',
  'content-length',
  'content-encoding',
  'content-type',
  'transfer-encoding',
  'content-security-policy',
]);

const withoutBodyHeaders = (headers: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !BODY_HEADERS.has(name.toLowerCase()),
    ),
  );

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A page that sends the browser to `target` as a new navigation (no script needed). */
const redirectPage = (target: string) =>
  `<!doctype html><meta http-equiv="refresh" content="0;url=${escapeHtml(target)}">`;

/**
 * What the remote portal browser may reach (v1: libs/portal/network-guard.ts).
 *
 * The browser runs on our server and a student drives it. Without limits it could open
 * our own network (localhost, the database, Redis, cloud metadata at 169.254.169.254)
 * and show the result on screen: SSRF. So every request goes through guard():
 *   - page navigations, in any frame, only to the portal's domains;
 *   - no request at all to a non-public address, checked after DNS resolution;
 *   - only http(s); downloads and service workers are off.
 * Images and scripts from other public hosts are allowed: portals load them from CDNs.
 */
@Injectable()
export class PortalNetworkPolicy {
  private readonly portalHosts: string[];
  private readonly dnsCache = new Map<
    string,
    { allowed: boolean; expires: number }
  >();

  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    @Optional()
    @Inject(PORTAL_ADDRESS_CHECK)
    private readonly isAllowedAddress: (
      ip: string,
    ) => boolean = isPublicAddress,
  ) {
    this.portalHosts = parseList(
      config.getOrThrow('PORTAL_ALLOWED_HOSTS', { infer: true }),
    );
  }

  /** The portal's domains and their subdomains: "syslbv4.liu.edu.lb" for "liu.edu.lb". */
  isPortalHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/\.$/, '');
    return this.portalHosts.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
  }

  /** Does the host resolve only to allowed (public) addresses? */
  async isPublicHost(hostname: string): Promise<boolean> {
    const host = hostname.replace(/^\[|\]$/g, ''); // IPv6 literals come in brackets
    if (isIP(host)) return this.isAllowedAddress(host);
    if (RESERVED_NAMES.test(host) && !this.isAllowedAddress('127.0.0.1'))
      return false;

    const cached = this.dnsCache.get(host);
    if (cached && cached.expires > Date.now()) return cached.allowed;

    let allowed = false;
    try {
      const addresses = await lookup(host, { all: true });
      // Every answer must be allowed, so a name can't mix a public and a private address.
      allowed =
        addresses.length > 0 &&
        addresses.every(({ address }) => this.isAllowedAddress(address));
    } catch {
      allowed = false; // doesn't resolve: the browser couldn't load it either
    }
    if (this.dnsCache.size > 2_000) this.dnsCache.clear();
    this.dnsCache.set(host, { allowed, expires: Date.now() + DNS_TTL_MS });
    return allowed;
  }

  /** Options for every portal browser context. */
  contextOptions(): BrowserContextOptions {
    return {
      acceptDownloads: false,
      // A service worker could make requests that skip the route handler below.
      serviceWorkers: 'block',
    };
  }

  /** Installs the request rules on a context. Call before it opens any page. */
  async guard(context: BrowserContext): Promise<void> {
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = parseHttpUrl(request.url());
      if (!url) return route.abort('blockedbyclient');
      if (request.isNavigationRequest() && !this.isPortalHost(url.hostname)) {
        return route.abort('blockedbyclient');
      }
      if (!(await this.isPublicHost(url.hostname))) {
        return route.abort('blockedbyclient');
      }

      if (request.isNavigationRequest()) {
        // Playwright calls this handler only for the first URL of a redirect chain, and
        // Chromium follows even a fulfilled 302 without calling it again. So with
        // route.continue() a portal page redirecting to 169.254.169.254 would skip every
        // check above (v1 had this gap). Instead, fetch without following redirects,
        // and turn a redirect into a page that navigates to the target: that is a new
        // navigation, which comes through this handler and its checks.
        const response = await route.fetch({ maxRedirects: 0 });
        const location = response.headers()['location'];
        if (response.status() >= 300 && response.status() < 400 && location) {
          return route.fulfill({
            status: 200,
            // Keep the response's cookies (e.g. the session set at login).
            headers: {
              ...withoutBodyHeaders(response.headers()),
              'content-type': 'text/html',
            },
            body: redirectPage(new URL(location, url).toString()),
          });
        }
        return route.fulfill({ response });
      }
      return route.continue();
    });

    // WebSockets opened by pages: only to the portal itself.
    await context.routeWebSocket(/.*/, async (ws) => {
      const url = parseHttpUrl(ws.url().replace(/^ws/, 'http'));
      if (
        url &&
        this.isPortalHost(url.hostname) &&
        (await this.isPublicHost(url.hostname))
      ) {
        ws.connectToServer();
      } else {
        await ws.close();
      }
    });
  }
}
