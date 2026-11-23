import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from 'playwright';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { htmlToText } from '../web/html-to-text.js';
import { pdfToText } from '../web/pdf-to-text.js';
import type { PortalInput } from './portal-input.js';
import { PortalNetworkPolicy } from './portal-network.policy.js';
import {
  detectTranscript,
  transcriptPdfFrom,
  type DetectionResult,
} from './transcript-detector.js';

/** The transcript as captured from the portal. */
export interface PortalCapture {
  url: string;
  title: string;
  capturedAt: string;
  /** Plain text of the page (and its iframes). */
  text: string;
  /** The original document, stored like an uploaded file. */
  file: { buffer: Buffer; mimeType: 'text/html' | 'application/pdf' };
}

/** What the frontend shows: pushed over the WebSocket and returned by GET /me/portal. */
export interface PortalStatus {
  running: boolean;
  url: string | null;
  title: string | null;
  loggedIn: boolean;
  onTranscript: boolean;
  score: number;
  threshold: number;
  reasons: string[];
  captured: {
    url: string;
    title: string;
    capturedAt: string;
    length: number;
  } | null;
}

export type ViewerMessage =
  | { type: 'frame'; data: string }
  | ({ type: 'status' } & PortalStatus)
  | { type: 'stopped'; reason: string };

/** One connected viewer (a WebSocket, adapted by the gateway). */
export interface PortalViewer {
  send(message: ViewerMessage): void;
  close(code: number, reason: string): void;
  onClose(handler: () => void): void;
}

export interface PortalTimings {
  /** A session nobody watches closes after this long. Defaults to PORTAL_IDLE_MINUTES. */
  idleMs: number;
  /** Hard cap on a session's life, even while watched. */
  maxLifetimeMs: number;
  /** How often the transcript detector runs, besides on every page load. */
  detectIntervalMs: number;
}

/** Injection token to change the timings (tests). */
export const PORTAL_TIMINGS = Symbol('PORTAL_TIMINGS');

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
const STOPPED_STATUS: PortalStatus = {
  running: false,
  url: null,
  title: null,
  loggedIn: false,
  onTranscript: false,
  score: 0,
  threshold: 5,
  reasons: [],
  captured: null,
};

interface Session {
  userId: string;
  context: BrowserContext;
  page: Page;
  cdp: CDPSession | null;
  viewers: Set<PortalViewer>;
  lastFrame: string | null;
  viewport: { width: number; height: number };
  detection: (DetectionResult & { url: string; title: string }) | null;
  pdf: { name: string; buffer: Buffer } | null;
  capture: PortalCapture | null;
  detecting: boolean;
  detectTimer: NodeJS.Timeout | null;
  pollTimer: NodeJS.Timeout;
  idleTimer: NodeJS.Timeout | null;
  lifetimeTimer: NodeJS.Timeout;
  closed: boolean;
}

/**
 * Remote student-portal browser sessions (v1: libs/portal/session.ts).
 *
 * One headless Chromium is shared; each student gets their own browser *context*
 * (separate cookies, storage and pages), so students never see each other's portal.
 * A session opens the portal's login page, streams JPEG frames of it to the student's
 * viewers (Chrome's screencast), replays their clicks and keys, runs the transcript
 * detector on every page load and on a timer, and captures the transcript page.
 *
 * Everything lives in memory: one backend process only. The student's password is
 * typed straight into the remote page and never read or stored. Sessions close on
 * stop, after the import, when nobody watches for a while, and at a maximum lifetime.
 */
@Injectable()
export class PortalSessions implements OnModuleDestroy {
  private readonly logger = new Logger(PortalSessions.name);
  private readonly sessions = new Map<string, Session>();
  private readonly starting = new Map<string, Promise<Session>>();
  private browserPromise: Promise<Browser> | null = null;
  private readonly watched = new WeakSet<Page>();

  private readonly startUrl: string;
  private readonly maxSessions: number;
  private readonly timings: PortalTimings;

  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    private readonly policy: PortalNetworkPolicy,
    @Optional() @Inject(PORTAL_TIMINGS) timings: Partial<PortalTimings> = {},
  ) {
    this.startUrl = config.getOrThrow('PORTAL_START_URL', { infer: true });
    this.maxSessions = config.getOrThrow('PORTAL_MAX_SESSIONS', {
      infer: true,
    });
    this.timings = {
      idleMs:
        config.getOrThrow('PORTAL_IDLE_MINUTES', { infer: true }) * 60_000,
      maxLifetimeMs: 30 * 60_000,
      detectIntervalMs: 1_500,
      ...timings,
    };
  }

  // ─── Public API ────────────────────────────────────────────

  /** Starts the student's portal browser, or returns the one already running. */
  async start(userId: string): Promise<PortalStatus> {
    const existing = this.sessions.get(userId);
    if (existing) return this.toStatus(existing);

    let pending = this.starting.get(userId);
    if (!pending) {
      if (this.sessions.size + this.starting.size >= this.maxSessions) {
        throw new ServiceUnavailableException(
          'All remote browsers are busy. Try again in a few minutes.',
        );
      }
      pending = this.launchSession(userId).finally(() =>
        this.starting.delete(userId),
      );
      this.starting.set(userId, pending);
    }

    try {
      return this.toStatus(await pending);
    } catch (error) {
      this.logger.error('Could not start a portal browser', error);
      await this.closeBrowserIfUnused();
      throw new ServiceUnavailableException(
        'Could not start the remote browser',
      );
    }
  }

  status(userId: string): PortalStatus {
    const session = this.sessions.get(userId);
    return session ? this.toStatus(session) : STOPPED_STATUS;
  }

  count(): number {
    return this.sessions.size;
  }

  /** The student's page, read-only use (the import, tests). */
  page(userId: string): Page | null {
    return this.sessions.get(userId)?.page ?? null;
  }

  /**
   * The transcript to import: a fresh capture of the page on screen (it may have
   * loaded more rows since detection), or the last capture if it can't be read now.
   */
  async getTranscript(userId: string): Promise<PortalCapture> {
    const session = this.sessions.get(userId);
    if (!session) throw new ConflictException('Open the portal browser first');

    const fresh = session.detection?.onTranscript
      ? await this.capture(session).catch(() => null)
      : null;
    const result = fresh?.text ? fresh : session.capture;
    if (!result?.text) {
      throw new ConflictException(
        'Open your transcript page in the portal first',
      );
    }
    return result;
  }

  async stop(userId: string, reason = 'Stopped'): Promise<void> {
    const session = this.sessions.get(userId);
    if (!session || session.closed) return;
    session.closed = true;
    this.sessions.delete(userId);

    clearInterval(session.pollTimer);
    clearTimeout(session.lifetimeTimer);
    if (session.idleTimer) clearTimeout(session.idleTimer);
    if (session.detectTimer) clearTimeout(session.detectTimer);

    this.broadcast(session, { type: 'stopped', reason });
    for (const viewer of session.viewers) viewer.close(1000, 'stopped');
    session.viewers.clear();
    session.capture = null;
    session.pdf = null;

    await session.context.close().catch(() => undefined);
    await this.closeBrowserIfUnused();
  }

  /** Lifecycle hook: on shutdown, close every browser (v1: stopAllPortalSessions). */
  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [...this.sessions.keys()].map((userId) =>
        this.stop(userId, 'Server shutting down'),
      ),
    );
    await Promise.all(
      [...this.starting.values()].map((p) => p.catch(() => undefined)),
    );
    await Promise.all(
      [...this.sessions.keys()].map((userId) =>
        this.stop(userId, 'Server shutting down'),
      ),
    );
    await this.closeBrowserIfUnused();
  }

  /** Attaches a viewer; false when the student has no session. */
  addViewer(userId: string, viewer: PortalViewer): boolean {
    const session = this.sessions.get(userId);
    if (!session) return false;

    session.viewers.add(viewer);
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = null;

    // A new view would stay blank until the page repaints, so send the last frame now.
    if (session.lastFrame)
      viewer.send({ type: 'frame', data: session.lastFrame });
    viewer.send({ type: 'status', ...this.toStatus(session) });

    viewer.onClose(() => {
      session.viewers.delete(viewer);
      if (session.viewers.size === 0 && !session.closed)
        this.armIdleTimer(session);
    });
    return true;
  }

  /** Replays one validated viewer input on the student's page. */
  async handleInput(userId: string, input: PortalInput): Promise<void> {
    const session = this.sessions.get(userId);
    if (!session || session.page.isClosed()) return;
    const { page } = session;

    switch (input.type) {
      case 'resize':
        // The remote page is exactly as big as the student's view.
        session.viewport = { width: input.width, height: input.height };
        await page.setViewportSize(session.viewport);
        // Restart the screencast so frames come at the new size.
        await session.cdp?.send('Page.stopScreencast').catch(() => undefined);
        await this.startScreencast(session);
        return;
      case 'click':
        return page.mouse.click(input.x, input.y);
      case 'scroll':
        return page.mouse.wheel(0, input.deltaY);
      case 'key':
        return page.keyboard.press(input.key);
      case 'text':
        return page.keyboard.insertText(input.text);
      case 'back':
        await page.goBack({ timeout: 15_000 });
        return;
      case 'reload':
        await page.reload({ timeout: 30_000 });
        return;
    }
  }

  // ─── Browser and sessions ──────────────────────────────────

  private getBrowser(): Promise<Browser> {
    this.browserPromise ??= chromium
      .launch({ headless: true })
      .then((browser) => {
        browser.on('disconnected', () => {
          this.browserPromise = null;
          // Deleting from a Map while iterating it is safe in JavaScript.
          for (const userId of this.sessions.keys()) {
            void this.stop(userId, 'The remote browser stopped');
          }
        });
        return browser;
      });
    // A failed launch must not stay cached.
    this.browserPromise.catch(() => (this.browserPromise = null));
    return this.browserPromise;
  }

  private async closeBrowserIfUnused(): Promise<void> {
    if (
      this.sessions.size > 0 ||
      this.starting.size > 0 ||
      !this.browserPromise
    )
      return;
    const browser = await this.browserPromise.catch(() => null);
    this.browserPromise = null;
    await browser?.close().catch(() => undefined);
  }

  private async launchSession(userId: string): Promise<Session> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      ...this.policy.contextOptions(),
      viewport: DEFAULT_VIEWPORT,
    });

    try {
      // The network rules are in place before any page exists.
      await this.policy.guard(context);
      const page = await context.newPage();

      const session: Session = {
        userId,
        context,
        page,
        cdp: null,
        viewers: new Set(),
        lastFrame: null,
        viewport: { ...DEFAULT_VIEWPORT },
        detection: null,
        pdf: null,
        capture: null,
        detecting: false,
        detectTimer: null,
        pollTimer: setInterval(
          () => void this.runDetection(session),
          this.timings.detectIntervalMs,
        ),
        idleTimer: null,
        lifetimeTimer: setTimeout(
          () => void this.stop(userId, 'The session reached its time limit'),
          this.timings.maxLifetimeMs,
        ),
        closed: false,
      };
      this.sessions.set(userId, session);
      this.armIdleTimer(session); // closed if the student never connects

      // The portal may open the transcript in a new tab: stream that tab instead, and
      // go back to the previous one when it closes. At most 5 tabs.
      context.on('page', (newPage) => {
        if (context.pages().length > 5) {
          void newPage.close().catch(() => undefined);
          return;
        }
        const previous = session.page;
        void this.attachPage(session, newPage)
          .then(() => newPage.setViewportSize(session.viewport))
          .catch(() => undefined);
        newPage.on('close', () => {
          if (
            session.page === newPage &&
            !previous.isClosed() &&
            !session.closed
          ) {
            void this.attachPage(session, previous).catch(() => undefined);
          }
        });
      });

      await this.attachPage(session, page);
      // A slow portal shouldn't fail the start: the student can press reload.
      await page
        .goto(this.startUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        .catch(() => this.logger.warn('Portal start page failed to load'));
      return session;
    } catch (error) {
      this.sessions.delete(userId);
      await context.close().catch(() => undefined);
      throw error;
    }
  }

  // ─── Viewers and screencast ────────────────────────────────

  private broadcast(session: Session, message: ViewerMessage): void {
    for (const viewer of session.viewers) viewer.send(message);
  }

  private pushStatus(session: Session): void {
    this.broadcast(session, { type: 'status', ...this.toStatus(session) });
  }

  // A session nobody watches is closed after a while; watching again cancels that.
  private armIdleTimer(session: Session): void {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(
      () => void this.stop(session.userId, 'Closed after being idle'),
      this.timings.idleMs,
    );
  }

  private toStatus(session: Session): PortalStatus {
    const url = session.page.isClosed() ? null : session.page.url();
    const { detection, capture } = session;
    return {
      running: true,
      url,
      title: detection?.title ?? null,
      // Signed in = on the portal and no password field on screen.
      loggedIn: Boolean(
        url &&
        detection &&
        !detection.loginForm &&
        this.isOnPortal(url) &&
        !/\/login/i.test(url),
      ),
      onTranscript: detection?.onTranscript ?? false,
      score: detection?.score ?? 0,
      threshold: detection?.threshold ?? 5,
      reasons: detection?.reasons ?? [],
      captured: capture
        ? {
            url: capture.url,
            title: capture.title,
            capturedAt: capture.capturedAt,
            length: capture.text.length,
          }
        : null,
    };
  }

  private isOnPortal(url: string): boolean {
    return URL.canParse(url) && this.policy.isPortalHost(new URL(url).hostname);
  }

  /** Streams a page: Chrome pushes a JPEG on every repaint. */
  private async attachPage(session: Session, page: Page): Promise<void> {
    if (session.cdp) await session.cdp.detach().catch(() => undefined);
    session.page = page;
    session.lastFrame = null;
    this.watchPage(session, page);
    this.scheduleDetection(session);

    const cdp = await page.context().newCDPSession(page);
    session.cdp = cdp;
    cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
      if (session.cdp !== cdp) return; // an old tab
      session.lastFrame = data;
      this.broadcast(session, { type: 'frame', data });
      void cdp
        .send('Page.screencastFrameAck', { sessionId })
        .catch(() => undefined);
    });
    await this.startScreencast(session);
  }

  private async startScreencast(session: Session): Promise<void> {
    await session.cdp?.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 70,
      maxWidth: session.viewport.width,
      maxHeight: session.viewport.height,
    });
  }

  // ─── Transcript detection and capture ──────────────────────

  private watchPage(session: Session, page: Page): void {
    if (this.watched.has(page)) return;
    this.watched.add(page);

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) session.pdf = null; // new page: forget the old PDF
      this.scheduleDetection(session);
    });
    page.on('load', () => this.scheduleDetection(session));

    // A transcript delivered as a PDF: keep its bytes, so its text can be read.
    page.on('response', (response) => {
      const name = transcriptPdfFrom(response);
      if (!name) return;
      response
        .body()
        .then((buffer) => {
          session.pdf = { name, buffer };
          this.scheduleDetection(session);
        })
        .catch(() => undefined);
    });
  }

  private scheduleDetection(session: Session, delay = 300): void {
    if (session.detectTimer) clearTimeout(session.detectTimer);
    session.detectTimer = setTimeout(
      () => void this.runDetection(session),
      delay,
    );
  }

  private async runDetection(session: Session): Promise<void> {
    if (session.closed || session.detecting || session.page.isClosed()) return;
    session.detecting = true;
    try {
      const previous = session.detection;
      const result = await detectTranscript(session.page, {
        pdf: session.pdf?.name ?? null,
      });
      const changed =
        !previous ||
        result.onTranscript !== previous.onTranscript ||
        result.score !== previous.score ||
        result.url !== previous.url ||
        result.loginForm !== previous.loginForm;
      session.detection = result;

      // On the transcript: capture it. Again when the score changes too, because
      // portals often fill the table in after the page has loaded.
      if (
        result.onTranscript &&
        (changed || session.capture?.url !== result.url)
      ) {
        session.capture = await this.capture(session);
        // The length only: page contents are never logged.
        this.logger.log(
          `Portal transcript captured (${session.capture.text.length} chars)`,
        );
      }
      if (changed) this.pushStatus(session);
    } catch {
      // The page was navigating or closed; the next run catches up.
    } finally {
      session.detecting = false;
    }
  }

  private async capture(session: Session): Promise<PortalCapture> {
    if (session.pdf) {
      const fromPdf = await this.capturePdf(session.page, session.pdf);
      if (fromPdf) return fromPdf;
    }
    return capturePage(session.page);
  }

  private async capturePdf(
    page: Page,
    pdf: { name: string; buffer: Buffer },
  ): Promise<PortalCapture | null> {
    const text = await pdfToText(pdf.buffer).catch(() => '');
    if (!text) return null;
    return {
      url: page.url(),
      title: pdf.name,
      capturedAt: new Date().toISOString(),
      text,
      file: { buffer: pdf.buffer, mimeType: 'application/pdf' },
    };
  }
}

/**
 * Grabs the HTML of the page and every iframe in it (transcripts are sometimes inside
 * one). The stored file holds all of it, so the worker reading it later sees the same
 * text the student saw (v1 kept only the main page's HTML).
 */
export async function capturePage(page: Page): Promise<PortalCapture> {
  const frames: { url: string; isMain: boolean; html: string }[] = [];
  for (const frame of page.frames()) {
    const html = await frame.content().catch(() => null); // frames can vanish mid-navigation
    if (html)
      frames.push({
        url: frame.url(),
        isMain: frame === page.mainFrame(),
        html,
      });
  }
  const main = frames.find((f) => f.isMain) ?? frames[0];
  const children = frames.filter((f) => f !== main && htmlToText(f.html));

  const html = [
    main?.html ?? '',
    ...children.map(
      (f) => `\n<!-- frame: ${f.url.replace(/--/g, '')} -->\n${f.html}`,
    ),
  ].join('');

  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    capturedAt: new Date().toISOString(),
    text: htmlToText(html),
    file: { buffer: Buffer.from(html, 'utf8'), mimeType: 'text/html' },
  };
}
