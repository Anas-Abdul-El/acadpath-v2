import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BlockedUrlError, fetchPublicUrl } from './safe-fetch.js';

// A real HTTP server on 127.0.0.1. The default policy blocks it (that's the point), so
// the happy-path tests pass an address check that allows loopback only.
let server: Server;
let base: string;
const allowLoopback = (ip: string) => ip === '127.0.0.1';

beforeAll(async () => {
  server = createServer((req, res) => {
    switch (req.url) {
      case '/page':
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<p>Hello</p>');
        return;
      case '/redirect':
        res.writeHead(302, { Location: '/page' });
        res.end();
        return;
      case '/redirect-private':
        res.writeHead(302, { Location: 'http://10.0.0.1/secret' });
        res.end();
        return;
      case '/redirect-loop':
        res.writeHead(302, { Location: '/redirect-loop' });
        res.end();
        return;
      case '/big':
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('x'.repeat(2048));
        return;
      case '/slow':
        // Never answers.
        return;
      default:
        res.writeHead(404);
        res.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe('fetchPublicUrl', () => {
  describe('with the default (public-only) policy', () => {
    it.each([
      ['a loopback IP', 'http://127.0.0.1/'],
      ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data'],
      ['a private IP', 'http://10.0.0.5/'],
      ['an IPv6 loopback', 'http://[::1]/'],
      ['a hostname resolving to loopback', 'http://localhost/'],
    ])('blocks %s', async (_case, url) => {
      await expect(fetchPublicUrl(url)).rejects.toThrow(BlockedUrlError);
    });

    it.each([
      ['file:', 'file:///etc/passwd'],
      ['ftp:', 'ftp://example.com/x'],
      ['a non-default port', 'http://example.com:6379/'],
      ['credentials in the URL', 'https://user:pw@example.com/'],
      ['a malformed URL', 'not a url'],
    ])('refuses %s', async (_case, url) => {
      await expect(fetchPublicUrl(url)).rejects.toThrow(BlockedUrlError);
    });
  });

  describe('with loopback allowed (to reach the test server)', () => {
    const fetchLocal = (path: string, options = {}) =>
      fetchPublicUrl(`${base}${path}`, {
        isAllowedAddress: allowLoopback,
        allowAnyPort: true,
        ...options,
      });

    it('returns the body, content type and final URL', async () => {
      const page = await fetchLocal('/page');

      expect(page.body.toString()).toBe('<p>Hello</p>');
      expect(page.contentType).toBe('text/html; charset=utf-8');
      expect(page.url).toBe(`${base}/page`);
    });

    it('follows a redirect and reports where it ended', async () => {
      const page = await fetchLocal('/redirect');

      expect(page.url).toBe(`${base}/page`);
    });

    it('checks every redirect hop: a redirect to a private address is blocked', async () => {
      await expect(fetchLocal('/redirect-private')).rejects.toThrow(
        BlockedUrlError,
      );
    });

    it('gives up after too many redirects', async () => {
      await expect(fetchLocal('/redirect-loop')).rejects.toThrow(
        'Too many redirects',
      );
    });

    it('stops reading a response larger than the limit', async () => {
      await expect(fetchLocal('/big', { maxBytes: 1024 })).rejects.toThrow(
        'Response is larger than 1024 bytes',
      );
    });

    it('times out a server that never answers', async () => {
      await expect(fetchLocal('/slow', { timeoutMs: 200 })).rejects.toThrow(
        'timed out',
      );
    });

    it('fails on an error status', async () => {
      await expect(fetchLocal('/missing')).rejects.toThrow('HTTP 404');
    });
  });
});
