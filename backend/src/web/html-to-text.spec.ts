import { htmlToText } from './html-to-text.js';

describe('htmlToText', () => {
  it('drops scripts, styles, hidden elements and form controls', () => {
    const html = `<body>
      <script>alert(1)</script><style>p{}</style>
      <p>Visible</p>
      <div hidden>Hidden</div><span style="display: none">Gone</span>
      <input value="secret"><textarea>typed</textarea>
    </body>`;

    expect(htmlToText(html)).toBe('Visible');
  });

  it('puts block elements and list items on their own lines', () => {
    const html =
      '<h2>Courses</h2><p>Intro</p><ul><li>One</li><li>Two</li></ul>';

    expect(htmlToText(html)).toBe('Courses\n\nIntro\n\n- One\n- Two');
  });

  it('turns each table row into one line with cells joined by " | "', () => {
    const html = `<table>
      <tr><th>Code</th><th>Title</th><th>Credits</th></tr>
      <tr><td>CSCI 250</td><td>Data  Structures</td><td>3</td></tr>
    </table>`;

    expect(htmlToText(html)).toBe(
      'Code | Title | Credits\nCSCI 250 | Data Structures | 3',
    );
  });

  it('keeps image alt text and link text', () => {
    expect(htmlToText('<p><a href="/x">Catalog</a> <img alt="Logo"></p>')).toBe(
      'Catalog Logo',
    );
  });
});
