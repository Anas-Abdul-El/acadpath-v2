import { chromium, type Browser, type Response } from 'playwright';
import {
  THRESHOLD,
  detectTranscript,
  scoreFeatures,
  transcriptPdfFrom,
  type FrameFeatures,
} from './transcript-detector.js';

const frame = (over: Partial<FrameFeatures> = {}): FrameFeatures => ({
  headings: [],
  tables: [],
  body: '',
  hasPasswordField: false,
  ...over,
});

const gradeTable = {
  headerCells: ['Course Code', 'Course Title', 'Credits', 'Grade'],
  cells: [
    ['CSCI 250', 'Data Structures', '3', 'B+'],
    ['MATH 210', 'Calculus', '3', 'A'],
    ['ENGL 101', 'English', '3', 'C-'],
  ],
};

describe('scoreFeatures (v1: transcriptDetector)', () => {
  it('scores a real transcript page above the threshold, with reasons', () => {
    const result = scoreFeatures({
      url: 'https://syslbv4.liu.edu.lb/student/transcript',
      title: 'Unofficial Transcript',
      frames: [
        frame({
          headings: ['Academic Transcript'],
          tables: [gradeTable],
          body: 'Cumulative GPA 3.2, credits earned 45. Fall 2023 ... Spring 2024 ...',
        }),
      ],
    });

    expect(result.onTranscript).toBe(true);
    expect(result.score).toBe(4 + 3 + 3 + 3 + 2 + 2 + 1);
    expect(result.threshold).toBe(THRESHOLD);
    expect(result.reasons).toContain('+4 URL mentions transcript');
    expect(result.loginForm).toBe(false);
  });

  it('does not count a "Transcript" menu link on an ordinary page', () => {
    // The browser-side step leaves out nav/menu/link text, so only the body mentions it.
    const result = scoreFeatures({
      url: 'https://syslbv4.liu.edu.lb/student/home',
      title: 'Home',
      frames: [frame({ body: 'Home Courses Transcript Logout' })],
    });

    expect(result.onTranscript).toBe(false);
    expect(result.score).toBe(0);
  });

  it('takes 5 points off for a login form, so a login page is never the transcript', () => {
    const result = scoreFeatures({
      url: 'https://syslbv4.liu.edu.lb/login/?next=/transcript',
      title: 'Login',
      frames: [frame({ hasPasswordField: true })],
    });

    expect(result.loginForm).toBe(true);
    expect(result.onTranscript).toBe(false);
    expect(result.reasons).toContain('-5 login/password form on page');
  });

  it('counts a received transcript PDF strongly', () => {
    const result = scoreFeatures({
      url: 'https://x/viewer',
      pdf: 'transcript.pdf',
    });

    expect(result.score).toBe(5);
    expect(result.onTranscript).toBe(true);
  });

  it('gives 2 points for a grades URL, not 4', () => {
    expect(scoreFeatures({ url: 'https://x/student/grades' }).score).toBe(2);
  });

  it('needs 3 rows with letter grades', () => {
    const twoRows = {
      ...gradeTable,
      headerCells: [],
      cells: gradeTable.cells.slice(0, 2),
    };
    expect(
      scoreFeatures({ frames: [frame({ tables: [twoRows] })] }).score,
    ).toBe(0);
  });
});

describe('transcriptPdfFrom', () => {
  const response = (headers: Record<string, string>, url = 'https://x/file') =>
    ({ headers: () => headers, url: () => url }) as unknown as Response;

  it('returns the file name of a transcript PDF', () => {
    expect(
      transcriptPdfFrom(
        response({
          'content-type': 'application/pdf',
          'content-disposition':
            'attachment; filename="Unofficial_Transcript.pdf"',
        }),
      ),
    ).toBe('Unofficial_Transcript.pdf');
  });

  it('falls back to the URL for the name', () => {
    expect(
      transcriptPdfFrom(
        response(
          { 'content-type': 'application/pdf' },
          'https://x/reports/grade%20report.pdf',
        ),
      ),
    ).toBe('grade report.pdf');
  });

  it.each([
    [
      'a PDF that is not a transcript',
      { 'content-type': 'application/pdf' },
      'https://x/handbook.pdf',
    ],
    [
      'an HTML transcript page',
      { 'content-type': 'text/html' },
      'https://x/transcript',
    ],
  ])('returns null for %s', (_case, headers, url) => {
    expect(transcriptPdfFrom(response(headers, url))).toBeNull();
  });
});

describe('detectTranscript (real browser)', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 30_000);

  afterAll(async () => {
    await browser.close();
  });

  it('recognises a transcript page, ignoring the menu', async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <title>Student Portal</title>
      <nav><a href="#">Transcript</a></nav>
      <h2>Academic Transcript</h2>
      <table>
        <tr><th>Course Code</th><th>Title</th><th>Credits</th><th>Grade</th></tr>
        <tr><td>CSCI 250</td><td>Data Structures</td><td>3</td><td>B+</td></tr>
        <tr><td>MATH 210</td><td>Calculus</td><td>3</td><td>A</td></tr>
        <tr><td>ENGL 101</td><td>English</td><td>3</td><td>C</td></tr>
      </table>
      <p>Fall 2023 Spring 2024 — GPA 3.1, credits 45</p>`);

    const result = await detectTranscript(page);

    expect(result.onTranscript).toBe(true);
    expect(result.reasons).toContain('+3 a page heading says transcript');
    await page.close();
  });

  it('sees the login form on a login page', async () => {
    const page = await browser.newPage();
    await page.setContent(
      '<h1>Sign in</h1><form><input name="u"><input type="password"></form>',
    );

    const result = await detectTranscript(page);

    expect(result.loginForm).toBe(true);
    expect(result.onTranscript).toBe(false);
    await page.close();
  });
});
