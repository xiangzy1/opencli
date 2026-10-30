import { describe, expect, it } from 'vitest';
import { parseItem } from './feed.js';

describe('bilibili feed PGC dynamics', () => {
    it('extracts the episode title, cover, and playback URL as a video', () => {
        const item = parseItem({
            id_str: '1264828363595317315',
            type: 'DYNAMIC_TYPE_PGC_UNION',
            modules: {
                module_author: { name: '人生一串 第四季', mid: 45189 },
                module_dynamic: { major: { pgc: {
                    title: '人生一串 第四季：趣味混剪1',
                    cover: 'http://i0.hdslb.com/bfs/archive/cover.jpg',
                    jump_url: 'https://www.bilibili.com/bangumi/play/ep7341498',
                    stat: { play: '2万', danmaku: '30' },
                } } },
            },
        });
        expect(item).toMatchObject({
            itemType: 'video',
            title: '人生一串 第四季：趣味混剪1',
            url: 'https://www.bilibili.com/bangumi/play/ep7341498',
            cover: 'https://i0.hdslb.com/bfs/archive/cover.jpg',
            images: 'http://i0.hdslb.com/bfs/archive/cover.jpg',
            plays: 20000,
            danmaku: 30,
        });
    });
});
