import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { buildFeedExtractScript, buildFeedImagesScript, buildFeedScrollScript, completeFeedImages, getInstagramFeed } from './feed.js';

function extract(html, url = 'https://www.instagram.com/') {
    const dom = new JSDOM(html, { url });
    return Function('window', 'document', `return ${buildFeedExtractScript()}`)(dom.window, dom.window.document);
}

// Reduced semantic structure observed on the live Chinese-language homepage.
function card(code = 'POST1', user = 'alice') {
    return `<article><a href="/${user}/">${user}</a>
        <a href="/p/${code}/"><time datetime="2026-10-04T10:00:00.000Z">1 h</time></a>
        <img alt="Photo" src="photo.jpg">
        <section><div><span><div role="button"><svg aria-label="赞"></svg></div></span>
        <span role="button">3.3&nbsp;万</span>
        <span><div role="button"><svg aria-label="评论"></svg></div></span><span role="button">453</span>
        <div role="button"><svg aria-label="转发"></svg></div><span role="button">610</span></div></section>
        <div><div><span><span><div><a href="/${user}/">${user}</a></div></span></span></div><span class="_aacu"><div><span class="_aacu">Hello <a href="/friend/">@friend</a> 🌿</span><span>更多</span></div></span></div>
        <div><a href="/commenter/">commenter</a><span class="_aacu">A comment</span></div>
    </article>`;
}

function pageFor(...payloads) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(async (script) => script.includes('scroller.scrollBy') ? false
            : payloads.length > 1 ? payloads.shift() : payloads[0]),
    };
}

const row = (url, user = 'alice') => ({ user, caption: 'Hello', likes: '', comments: '', type: 'photo', date: '', url, images: ['https://cdn.example.com/photo.jpg'] });
const ok = (...rows) => ({ status: 'ok', rows });

describe('instagram feed extraction', () => {
    it('registers a read-only homepage command without a username argument', () => {
        const cmd = getRegistry().get('instagram/feed');
        expect(cmd.access).toBe('read');
        expect(cmd.args.map((arg) => arg.name)).toEqual(['limit']);
        expect(cmd.columns).toContain('url');
    });

    it('extracts observed homepage fields and preserves localized rounded counts', () => {
        const payload = extract(`<main>${card()}</main>`);
        expect(payload.status).toBe('ok');
        expect(payload.rows).toEqual([{
            user: 'alice', caption: 'Hello @friend 🌿', likes: '3.3 万', comments: '453',
            type: 'photo', date: '2026-10-04T10:00:00.000Z', url: 'https://www.instagram.com/p/POST1/',
            images: ['https://www.instagram.com/photo.jpg'],
            media: [{ type: 'image', url: 'https://www.instagram.com/photo.jpg' }],
        }]);
    });

    it('extracts the post author avatar without confusing it with other avatars', () => {
        const html = card().replace('<a href="/alice/">alice</a>', '<a href="/alice/"><img src="https://cdn.example.com/alice.jpg" alt="Alice avatar"></a><a href="/alice/">alice</a>');
        const row = extract(`<main>${html}</main>`).rows[0];
        expect(row.author_avatar).toBe('https://cdn.example.com/alice.jpg');
        expect(row.images).toEqual(['https://www.instagram.com/photo.jpg']);
        expect(getRegistry().get('instagram/feed').columns).toContain('author_avatar');
    });

    it('extracts the author avatar rendered outside the profile link', () => {
        const html = card().replace('<a href="/alice/">alice</a>', '<span role="link"><img src="https://cdn.example.com/alice.jpg" alt="alice的头像"></span><a href="/alice/">alice</a>');
        const row = extract(`<main>${html}</main>`).rows[0];
        expect(row.author_avatar).toBe('https://cdn.example.com/alice.jpg');
        expect(row.images).toEqual(['https://www.instagram.com/photo.jpg']);
    });

    it('handles English controls, video and carousel cards', () => {
        const video = card('VIDEO').replace('aria-label="赞"', 'aria-label="Unlike"')
            .replace('aria-label="评论"', 'aria-label="Comment"').replace('<img alt="Photo" src="photo.jpg">', '<video></video>');
        const carousel = card('CAROUSEL').replace('</article>', '<button aria-label="Go to slide 2"></button></article>');
        const payload = extract(`<main>${video}${carousel}</main>`);
        expect(payload.rows.map((r) => r.type)).toEqual(['video', 'carousel']);
        expect(payload.rows[0].likes).toBe('3.3 万');
    });

    it('recognizes an offscreen video rendered as a poster using its matching media metadata', () => {
        const dom = new JSDOM(`<main>${card()}</main>`, { url: 'https://www.instagram.com/' });
        dom.window.document.querySelector('article').__reactFiberTest = {
            memoizedProps: {}, return: { memoizedProps: { mediaFragmentKey: { code: 'POST1', media_type: 2 } } },
        };
        const payload = Function('window', 'document', `return ${buildFeedExtractScript()}`)(dom.window, dom.window.document);
        expect(payload.rows[0].type).toBe('video');
    });

    it.each(['Sponsored', '广告', '赞助内容'])('filters the header promotion label %s before media', (label) => {
        const sponsored = card('AD').replace('<img alt="Photo"', `<span>${label}</span><img alt="Photo"`);
        expect(extract(`<main>${sponsored}${card('NORMAL', 'brand')}</main>`).rows.map((r) => r.url)).toEqual(['https://www.instagram.com/p/NORMAL/']);
    });

    it.each([{ is_ad: true }, { ad_id: 'ad-42' }, { inventory_source: 'ad' }])('filters explicit promotion metadata %j', (adMetadata) => {
        const dom = new JSDOM(`<main>${card()}</main>`, { url: 'https://www.instagram.com/' });
        dom.window.document.querySelector('article').__reactFiberTest = {
            memoizedProps: { mediaFragmentKey: { code: 'POST1', media_type: 1, ...adMetadata } },
        };
        const payload = Function('window', 'document', `return ${buildFeedExtractScript()}`)(dom.window, dom.window.document);
        expect(payload.rows).toEqual([]);
    });

    it('filters a card ad identifier even when media metadata occurs earlier in its component chain', () => {
        const dom = new JSDOM(`<main>${card()}</main>`, { url: 'https://www.instagram.com/' });
        dom.window.document.querySelector('article').__reactFiberTest = {
            memoizedProps: { mediaFragmentKey: { code: 'POST1', media_type: 1 } },
            return: { memoizedProps: { adProps: { ad_id: 'ad-42' } } },
        };
        expect(Function('window', 'document', `return ${buildFeedExtractScript()}`)(dom.window, dom.window.document).rows).toEqual([]);
    });

    it('keeps brands, recommendations, and captions that mention advertising', () => {
        const html = card('NORMAL', 'brand').replace('Hello <a href="/friend/">@friend</a> 🌿', 'Sponsored')
            .replace('<img alt="Photo"', '<span>为你推荐</span><img alt="Photo"');
        expect(extract(`<main>${html}</main>`).rows).toHaveLength(1);
    });

    it('supports reel permalinks and normalizes query strings', () => {
        const payload = extract(`<main>${card().replace('/p/POST1/', '/reel/POST1/?utm_source=feed')}</main>`);
        expect(payload.rows[0].type).toBe('video');
        expect(payload.rows[0].url).toBe('https://www.instagram.com/reel/POST1/');
    });

    it('excludes sidebars, suggestions, stories and modal posts', () => {
        const payload = extract(`<main><aside>${card()}</aside><div role="dialog">${card()}</div>
            <article><a href="/suggested/">suggested</a><img src="avatar.jpg"></article>
            <a href="/stories/alice/123/">Story</a></main>`);
        expect(payload.rows).toEqual([]);
        expect(payload.status).toBe('no_rows');
    });

    it('leaves hidden engagement and absent captions empty rather than inventing zeros', () => {
        const payload = extract('<main><article><a href="/alice/">alice</a><a href="/p/X/">Post</a><div><a href="/commenter/">commenter</a><span class="_aacu">Not a caption</span></div></article></main>');
        expect(payload.rows[0]).toMatchObject({ caption: '', likes: '', comments: '' });
    });

    it('recognizes login, challenge and explicitly exhausted feeds', () => {
        expect(extract('', 'https://www.instagram.com/accounts/login/').status).toBe('auth');
        expect(extract('', 'https://www.instagram.com/challenge/').status).toBe('auth');
        expect(extract('<input name="username"><input name="password">').status).toBe('auth');
        expect(extract('<main>You\'re all caught up</main>').status).toBe('empty');
    });
});

describe('instagram feed images', () => {
    it('excludes author and liked-by avatars while keeping post photos', () => {
        const html = card().replace('<img alt="Photo"', '<img alt="alice的头像" src="avatar.jpg"><img alt="" src="https://cdn.example.com/v/t51.2885-19/avatar.jpg"><img alt="Photo"');
        expect(extract(`<main>${html}</main>`).rows[0].images).toEqual(['https://www.instagram.com/photo.jpg']);
    });

    it('reads every carousel image in API order and chooses its largest rendition', async () => {
        const media = { code: 'ABC', media_type: 8, carousel_media: [
            { image_versions2: { candidates: [{ width: 320, url: 'https://cdn.example.com/1-small.jpg' }, { width: 1440, url: 'https://cdn.example.com/1.jpg' }] } },
            { media_type: 2, image_versions2: { candidates: [{ width: 1080, url: 'https://cdn.example.com/2-cover.jpg' }] }, video_versions: [{ width: 320, url: 'https://cdn.example.com/2-small.mp4' }, { width: 1080, url: 'https://cdn.example.com/2.mp4' }] },
            { image_versions2: { candidates: [{ width: 1080, url: 'https://cdn.example.com/3.jpg' }] } },
        ] };
        const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ok', items: [media] }) });
        const result = await Function('fetch', `return ${buildFeedImagesScript('ABC')}`)(fetch);
        expect(result).toEqual({ status: 'ok', images: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2-cover.jpg', 'https://cdn.example.com/3.jpg'], media: [
            { type: 'image', url: 'https://cdn.example.com/1.jpg' },
            { type: 'video', url: 'https://cdn.example.com/2.mp4', poster: 'https://cdn.example.com/2-cover.jpg' },
            { type: 'image', url: 'https://cdn.example.com/3.jpg' },
        ] });
        expect(fetch.mock.calls[0][0]).toBe('/api/v1/media/66/info/');
    });

    it('does not silently omit a carousel slide that lacks an image', async () => {
        const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [{ code: 'ABC', media_type: 8, carousel_media: [{ image_versions2: { candidates: [] } }] }] }) });
        expect((await Function('fetch', `return ${buildFeedImagesScript('ABC')}`)(fetch)).status).toBe('error');
    });

    it('replaces incomplete DOM images without refetching complete single-photo posts', async () => {
        const page = pageFor({ data: { status: 'ok', images: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'], media: [
            { type: 'image', url: 'https://cdn.example.com/1.jpg' }, { type: 'image', url: 'https://cdn.example.com/2.jpg' },
        ] } });
        const posts = [row('https://www.instagram.com/p/SINGLE/'), { ...row('https://www.instagram.com/p/ABC/'), type: 'carousel' }];
        await completeFeedImages(page, posts);
        expect(page.evaluate).toHaveBeenCalledTimes(1);
        expect(posts[1].images).toEqual(['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg']);
    });

    it.each(['auth', 'rate_limited', 'error'])('fails explicitly on image metadata status %s', async (status) => {
        const page = pageFor({ status });
        await expect(completeFeedImages(page, [{ ...row('https://www.instagram.com/p/ABC/'), type: 'carousel' }])).rejects.toThrow();
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('loads playable video metadata even when the DOM already contains its poster', async () => {
        const video = { type: 'video', url: 'https://cdn.example.com/video.mp4', poster: 'https://cdn.example.com/poster.jpg' };
        const page = pageFor({ status: 'ok', images: [video.poster], media: [video] });
        const posts = [{ ...row('https://www.instagram.com/reel/ABC/'), type: 'video' }];
        await completeFeedImages(page, posts);
        expect(page.evaluate).toHaveBeenCalledTimes(1);
        expect(posts[0].media).toEqual([video]);
    });

    it('does not silently replace an unavailable video with a cover image', async () => {
        const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [{ code: 'ABC', media_type: 2, image_versions2: { candidates: [{ width: 1080, url: 'https://cdn.example.com/poster.jpg' }] } }] }) });
        expect(await Function('fetch', `return ${buildFeedImagesScript('ABC')}`)(fetch)).toMatchObject({ status: 'error', message: expect.stringContaining('playable renditions') });
    });
});

describe('instagram feed scrolling and errors', () => {
    it.each([0, -1, 1.5, 101, 'bad'])('rejects invalid limit %s before navigation', async (limit) => {
        const page = pageFor(ok());
        await expect(getInstagramFeed(page, { limit })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('accumulates virtualized pages, deduplicates and respects limit', async () => {
        const page = pageFor(ok(row('a')), { data: ok(row('a'), row('b'), row('c')) });
        const rows = await getInstagramFeed(page, { limit: 2 });
        expect(rows.map((r) => [r.index, r.url])).toEqual([[1, 'a'], [2, 'b']]);
        expect(page.wait).toHaveBeenCalledTimes(1);
    });

    it('retains earlier rows when old cards are unmounted', async () => {
        const page = pageFor(ok(row('a')), ok(row('b')));
        const rows = await getInstagramFeed(page, { limit: 2 });
        expect(rows.map((r) => r.url)).toEqual(['a', 'b']);
    });

    it('stops on repeated pages and returns fewer rows when exhausted', async () => {
        const page = pageFor(ok(row('a')));
        expect(await getInstagramFeed(page, { limit: 20 })).toHaveLength(1);
        expect(page.wait).toHaveBeenCalledTimes(3);
    });

    it('waits through an initially unrendered feed', async () => {
        const page = pageFor({ status: 'no_rows', rows: [] }, ok(row('a')));
        expect(await getInstagramFeed(page, { limit: 1 })).toHaveLength(1);
    });

    it('keeps crossing viewports with unchanged cards until the bottom is reached', async () => {
        const page = pageFor(ok(row('a')));
        let scans = 0;
        page.evaluate.mockImplementation(async (script) => {
            if (script.includes('scroller.scrollBy')) return { data: true };
            scans++;
            return scans < 5 ? ok(row('a')) : ok(row('b'));
        });
        expect((await getInstagramFeed(page, { limit: 2 })).map((r) => r.url)).toEqual(['a', 'b']);
        expect(page.wait).toHaveBeenCalledTimes(4);
    });

    it('scrolls a nested feed container instead of unrelated page chrome', () => {
        const dom = new JSDOM('<main style="overflow-y: auto"><article></article></main>');
        const main = dom.window.document.querySelector('main');
        Object.defineProperties(main, { scrollHeight: { value: 3000 }, clientHeight: { value: 800 } });
        main.scrollBy = vi.fn(({ top }) => { main.scrollTop += top; });
        const moved = Function('window', 'document', `return ${buildFeedScrollScript()}`)(dom.window, dom.window.document);
        expect(moved).toBe(true);
        expect(main.scrollBy).toHaveBeenCalledWith({ top: 640, behavior: 'instant' });
    });

    it('classifies authentication, empty feeds, markup drift and malformed results', async () => {
        await expect(getInstagramFeed(pageFor({ status: 'auth', rows: [] }), { limit: 1 })).rejects.toBeInstanceOf(AuthRequiredError);
        await expect(getInstagramFeed(pageFor({ status: 'empty', rows: [] }), { limit: 1 })).rejects.toBeInstanceOf(EmptyResultError);
        await expect(getInstagramFeed(pageFor({ status: 'no_rows', rows: [], articleCount: 1 }), { limit: 1 })).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(getInstagramFeed(pageFor({ rows: null }), { limit: 1 })).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(getInstagramFeed(pageFor(ok({ user: 'alice' })), { limit: 1 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('wraps navigation failures in a typed command error', async () => {
        const page = pageFor(ok());
        page.goto.mockRejectedValue(new Error('Connection lost'));
        await expect(getInstagramFeed(page, { limit: 1 })).rejects.toThrow('Failed to read Instagram feed: Connection lost');
    });
});
