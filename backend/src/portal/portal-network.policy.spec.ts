import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { chromium, type Browser } from 'playwright';
import { PortalNetworkPolicy } from './portal-network.policy.js';

const policyFor = (hosts: string, isAllowedAddress?: (ip: string) => boolean) =>
  new PortalNetworkPolicy(
    new ConfigService({ PORTAL_ALLOWED_HOSTS: hosts }),
    isAllowedAddress,
  );

describe('PortalNetworkPolicy', () => {
  describe('isPortalHost', () => {
    const policy = policyFor('liu.edu.lb');

    it.each([
      'liu.edu.lb',
      'syslbv4.liu.edu.lb',
      'SYSLBV4.LIU.EDU.LB',
      'liu.edu.lb.',
    ])('allows %s', (host) => expect(policy.isPortalHost(host)).toBe(true));

    it.each([
      'evilliu.edu.lb',
      'liu.edu.lb.evil.example',
      'edu.lb',
      'example.com',
    ])('refuses %s', (host) => expect(policy.isPortalHost(host)).toBe(false));
  });

  describe('isPublicHost', () => {
    const policy = policyFor('liu.edu.lb');

    it.each([
      ['a private IP literal', '10.0.0.1'],
      ['the cloud metadata address', '169.254.169.254'],
      ['an IPv6 loopback literal', '[::1]'],
      ['an IPv4-mapped loopback', '[::ffff:127.0.0.1]'],
      ['localhost', 'localhost'],
      ['a .localhost name', 'portal.localhost'],
      ['a .internal name', 'metadata.google.internal'],
      ['a name that does not resolve', 'nothing.invalid'],
    ])('refuses %s', async (_case, host) => {
      await expect(policy.isPublicHost(host)).resolves.toBe(false);
    });

    it('allows a public IP literal', async () => {
      await expect(policy.isPublicHost('8.8.8.8')).resolves.toBe(true);
    });
  });

  // A real headless Chromium against a local server. The default policy blocks the
  // local server (it is loopback), so these tests allow 127.0.0.1 and nothing else.
  describe('guard (real browser)', () => {
    let server: Server;
    let port: number;
    let browser: Browser;

    beforeAll(async () => {
      server = createServer((req, res) => {
        if (req.url === '/redirect-away') {
          res.writeHead(302, { Location: 'http://example.com/' });
          res.end();
          return;
        }
        if (req.url === '/redirect-home') {
          res.writeHead(302, { Location: '/home' });
          res.end();
          return;
        }
        if (req.url === '/login-redirect') {
          res.writeHead(302, {
            Location: '/home',
            'Set-Cookie': 'session=abc; Path=/; HttpOnly',
          });
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          req.url === '/with-private-image'
            ? '<img src="http://10.255.255.1/x.png"><p>page</p>'
            : '<h1>portal</h1>',
        );
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      port = (server.address() as AddressInfo).port;
      browser = await chromium.launch({ headless: true });
    }, 30_000);

    afterAll(async () => {
      await browser.close();
      server.close();
    });

    const guardedPage = async () => {
      // localhost resolves to 127.0.0.1 and ::1; every resolved address must pass.
      const policy = policyFor(
        'localhost',
        (ip) => ip === '127.0.0.1' || ip === '::1',
      );
      const context = await browser.newContext(policy.contextOptions());
      await policy.guard(context);
      return context.newPage();
    };

    it('opens pages on the portal host', async () => {
      const page = await guardedPage();
      await page.goto(`http://localhost:${port}/`);

      expect(await page.textContent('h1')).toBe('portal');
    });

    it('refuses to navigate anywhere else', async () => {
      const page = await guardedPage();

      await expect(page.goto(`http://127.0.0.1:${port}/`)).rejects.toThrow();
      await expect(page.goto('http://example.com/')).rejects.toThrow();
    });

    it('refuses non-http schemes', async () => {
      const page = await guardedPage();

      await expect(page.goto('file:///etc/passwd')).rejects.toThrow();
    });

    it('checks redirects too: a portal page redirecting off the portal never loads the target', async () => {
      const page = await guardedPage();
      const loaded: string[] = [];
      page.on('response', (response) => loaded.push(response.url()));

      await page.goto(`http://localhost:${port}/redirect-away`);
      // The page tries to follow the redirect; give it time to (fail to) get there.
      await page.waitForTimeout(500);

      expect(loaded.some((u) => u.startsWith('http://example.com'))).toBe(
        false,
      );
      expect(page.url()).not.toContain('example.com');
    });

    it('still follows a redirect within the portal (e.g. login → dashboard)', async () => {
      const page = await guardedPage();

      await page.goto(`http://localhost:${port}/redirect-home`);
      await page.waitForURL(`http://localhost:${port}/home`);

      expect(await page.textContent('h1')).toBe('portal');
    });

    it('keeps cookies set by a redirect (the session from a login)', async () => {
      const page = await guardedPage();

      await page.goto(`http://localhost:${port}/login-redirect`);
      await page.waitForURL(`http://localhost:${port}/home`);

      const cookies = await page.context().cookies();
      expect(cookies.map((c) => c.name)).toContain('session');
    });

    it('blocks a resource on a private address, while the page still loads', async () => {
      const page = await guardedPage();
      const failed: string[] = [];
      page.on('requestfailed', (request) => failed.push(request.url()));

      await page.goto(`http://localhost:${port}/with-private-image`);
      await page.waitForLoadState('load');

      expect(await page.textContent('p')).toBe('page');
      expect(failed).toContain('http://10.255.255.1/x.png');
    });

    it('turns off downloads and service workers', () => {
      expect(policyFor('liu.edu.lb').contextOptions()).toMatchObject({
        acceptDownloads: false,
        serviceWorkers: 'block',
      });
    });
  });
});
