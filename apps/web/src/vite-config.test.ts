import { describe, expect, it } from 'vitest';
import config from '../vite.config';

describe('Vite dev proxy', () => {
  it('forwards /api to the API unchanged (no path rewrite)', () => {
    const proxy = config.server?.proxy?.['/api'];
    expect(proxy).toEqual({ target: 'http://127.0.0.1:3000', changeOrigin: true });
  });
});
