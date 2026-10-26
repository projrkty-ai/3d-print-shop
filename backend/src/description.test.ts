import { describe, expect, it } from 'vitest';
import { sanitizeDescription } from './description';

describe('rich description sanitization', () => {
  it('preserves formatting, media labels and safe sources without styling or event handlers', () => {
    const html = sanitizeDescription('<h2>Title</h2><p><u>Text</u> <a href="https://example.com" target="_blank">Link</a></p><img src="/api/media-files/123" alt="View" style="position:fixed"><video src="https://example.com/demo.webm" title="Demo" autoplay></video>');
    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('alt="View"');
    expect(html).toContain('title="Demo"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toMatch(/style=|autoplay|target=/);
  });
  it('strips active content and malformed or script-bearing media URLs', () => {
    const html = sanitizeDescription('<script>secret()</script><style>body{display:none}</style><svg onload="alert(1)"></svg><img src="https://%" onerror="alert(1)"><video src="javascript:alert(1)"><source src="data:video/mp4;base64,AA=="></video><a href="javascript:alert(1)">Text</a>');
    expect(html).not.toMatch(/secret|script|style|svg|onerror|data:|https:\/\/%/);
    expect(html).toContain('Text');
  });
});
