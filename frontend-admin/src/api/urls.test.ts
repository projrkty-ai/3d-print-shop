import { describe, expect, it } from 'vitest';
import { resolveAssetUrl } from './urls';

describe('independently hosted admin assets', () => {
  it.each(['/api/model-files/123', '/models/demo.3mf', '/photos/example.png'])('resolves %s on the backend origin', (path) => {
    expect(resolveAssetUrl(path, 'https://api.example/api')).toBe(`https://api.example${path}`);
  });
  it.each(['https://images.example/photo.jpg', 'data:image/png;base64,AA==', 'blob:https://admin.example/123'])('preserves standalone URLs: %s', (url) => {
    expect(resolveAssetUrl(url, 'https://api.example/api')).toBe(url);
  });
  it('keeps relative assets on the development proxy', () => {
    expect(resolveAssetUrl('/models/demo.3mf', '/api')).toBe('/models/demo.3mf');
  });
});
