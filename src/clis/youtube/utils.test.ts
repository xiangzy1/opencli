import { describe, expect, it, vi } from 'vitest';
import { prepareYoutubeApiPage } from './utils.js';

describe('youtube utils', () => {
  it('prepareYoutubeApiPage loads the quiet API bootstrap page', async () => {
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
    };

    await expect(prepareYoutubeApiPage(page as any)).resolves.toBeUndefined();
    expect(page.goto).toHaveBeenCalledWith('https://www.youtube.com', { waitUntil: 'none' });
    expect(page.wait).toHaveBeenCalledWith(2);
  });
});
