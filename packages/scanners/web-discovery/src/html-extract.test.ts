import { describe, expect, it } from 'vitest';
import { extractFromHtml } from './html-extract.js';

describe('extractFromHtml — navigational links', () => {
  it('extracts anchor hrefs', () => {
    const { navigational } = extractFromHtml('<a href="/about">About</a>', 100);
    expect(navigational).toContain('/about');
  });

  it('extracts area hrefs', () => {
    const { navigational } = extractFromHtml('<map><area href="/region1" shape="rect"></map>', 100);
    expect(navigational).toContain('/region1');
  });

  it('extracts iframe and frame src', () => {
    const { navigational } = extractFromHtml(
      '<iframe src="/embed1"></iframe><frameset><frame src="/embed2"></frameset>',
      100,
    );
    expect(navigational).toContain('/embed1');
    expect(navigational).toContain('/embed2');
  });

  it('extracts link href', () => {
    const { navigational } = extractFromHtml('<link rel="stylesheet" href="/style.css">', 100);
    expect(navigational).toContain('/style.css');
  });
});

describe('extractFromHtml — resource references', () => {
  it('extracts script, img, source, video, audio, object', () => {
    const html = `
      <script src="/app.js"></script>
      <img src="/logo.png">
      <video><source src="/movie.mp4"></video>
      <audio src="/sound.mp3"></audio>
      <object data="/file.pdf"></object>
    `;
    const { resources } = extractFromHtml(html, 100);
    expect(resources).toEqual(
      expect.arrayContaining(['/app.js', '/logo.png', '/movie.mp4', '/sound.mp3', '/file.pdf']),
    );
  });

  it('keeps navigational and resource URLs in separate lists', () => {
    const { navigational, resources } = extractFromHtml(
      '<a href="/page">x</a><img src="/pic.png">',
      100,
    );
    expect(navigational).toEqual(['/page']);
    expect(resources).toEqual(['/pic.png']);
  });
});

describe('extractFromHtml — malformed HTML', () => {
  it('does not throw on malformed/unclosed markup', () => {
    expect(() => extractFromHtml('<a href="/x"><div><span>unclosed', 100)).not.toThrow();
  });

  it('still extracts links from malformed HTML', () => {
    const { navigational } = extractFromHtml('<a href="/x"><p>text<a href="/y">', 100);
    expect(navigational).toEqual(expect.arrayContaining(['/x', '/y']));
  });

  it('respects maxLinksPerPage', () => {
    const html = Array.from({ length: 10 }, (_, i) => `<a href="/p${i}">`).join('');
    const { navigational } = extractFromHtml(html, 3);
    expect(navigational).toHaveLength(3);
  });
});

describe('extractFromHtml — forms', () => {
  it('extracts a GET form with input metadata', () => {
    const html = `<form action="/search" method="GET">
      <input name="q" type="text">
      <input name="submit" type="submit">
    </form>`;
    const { forms } = extractFromHtml(html, 100);
    expect(forms).toHaveLength(1);
    expect(forms[0]?.actionUrl).toBe('/search');
    expect(forms[0]?.method).toBe('GET');
    expect(forms[0]?.inputs).toEqual(expect.arrayContaining([{ name: 'q', type: 'text' }]));
  });

  it('extracts a POST form (recorded, never submitted)', () => {
    const html = `<form action="/login" method="POST">
      <input name="username" type="text">
      <input name="password" type="password">
    </form>`;
    const { forms } = extractFromHtml(html, 100);
    expect(forms[0]?.method).toBe('POST');
    expect(forms[0]?.inputs).toEqual(
      expect.arrayContaining([
        { name: 'username', type: 'text' },
        { name: 'password', type: 'password' },
      ]),
    );
  });

  it('defaults method to GET when unspecified', () => {
    const { forms } = extractFromHtml('<form action="/x"></form>', 100);
    expect(forms[0]?.method).toBe('GET');
  });

  it('records a form with no action attribute as an empty action (resolves to the current page)', () => {
    const { forms } = extractFromHtml('<form method="POST"><input name="a"></form>', 100);
    expect(forms[0]?.actionUrl).toBe('');
  });

  it('extracts textarea and select field names', () => {
    const html = `<form action="/feedback">
      <textarea name="comments"></textarea>
      <select name="rating"><option value="5">5</option></select>
    </form>`;
    const { forms } = extractFromHtml(html, 100);
    expect(forms[0]?.textareas).toContain('comments');
    expect(forms[0]?.selects).toContain('rating');
  });

  it('never triggers a submission — extraction is purely metadata', () => {
    const html = '<form action="/delete-account" method="POST"><input name="confirm"></form>';
    const { forms } = extractFromHtml(html, 100);
    expect(forms).toHaveLength(1);
    // No network activity is possible from this module at all — it never imports an HTTP client.
  });
});
