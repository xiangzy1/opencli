import { describe, expect, it } from 'vitest';
import { __test__ } from './chat.js';

describe('xianyu chat helpers', () => {
  it('builds goofish im urls from ids', () => {
    expect(__test__.buildChatUrl('1038951278192', '3650092411')).toBe(
      'https://www.goofish.com/im?itemId=1038951278192&peerUserId=3650092411',
    );
  });

  it('normalizes numeric ids', () => {
    expect(__test__.normalizeId('1038951278192', 'item_id')).toBe('1038951278192');
    expect(__test__.normalizeId(3650092411, 'user_id')).toBe('3650092411');
  });

  it('rejects non-numeric ids', () => {
    expect(() => __test__.normalizeId('abc', 'item_id')).toThrow();
    expect(() => __test__.normalizeId('3650092411x', 'user_id')).toThrow();
  });
});
