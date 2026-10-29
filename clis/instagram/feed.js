import { buildFeedImagesScript } from './_shared/feed-images.js';
import { ArgumentError, AuthRequiredError, CliError, CommandExecutionError, EmptyResultError, EXIT_CODES } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

// Run in the browser. Select semantic post boundaries rather than obfuscated
// layout classes; counts and captions intentionally retain the visible values.
function extractFeed() {
    const clean = (node) => (node?.innerText ?? node?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const path = window.location.pathname;
    if (/^\/(accounts\/login|challenge|checkpoint)(\/|$)/.test(path)
        || document.querySelector('input[name="username"]') && document.querySelector('input[name="password"]')) {
        return { status: 'auth', rows: [] };
    }
    const articles = [...document.querySelectorAll('main article, main [role="article"]')];
    const rows = [];
    const countPattern = /^\d[\d,.\s]*(?:[kmb万亿])?$/i;
    function actionCount(article, labels) {
        const icon = [...article.querySelectorAll('svg[aria-label]')]
            .find((el) => labels.includes(el.getAttribute('aria-label')));
        const button = icon?.closest('button, [role="button"]');
        for (let node = button; node && node !== article && node.tagName !== 'SECTION'; node = node.parentElement) {
            const value = clean(node.nextElementSibling);
            if (countPattern.test(value)) return value;
        }
        return '';
    }
    for (const article of articles) {
        if (article.closest('aside, nav, [role="dialog"]')) continue;
        const links = [...article.querySelectorAll('a[href]')];
        const permalink = links.find((a) => {
            const url = new URL(a.href, window.location.href);
            return url.hostname === 'www.instagram.com' && /^\/(p|reel)\/[^/]+\/?$/.test(url.pathname);
        });
        if (!permalink) continue;
        const postUrl = new URL(permalink.href, window.location.href);
        const author = links.find((a) => {
            const url = new URL(a.href, window.location.href);
            return url.hostname === 'www.instagram.com' && /^\/[\w.]+\/$/.test(url.pathname)
                && !/^\/(explore|accounts|direct|reels)\/$/.test(url.pathname) && clean(a);
        });
        if (!author) continue;
        const user = new URL(author.href, window.location.href).pathname.split('/')[1];
        // Avatar and name can be separate links in the post header; match the
        // same profile, rather than taking an unrelated liked-by avatar.
        const avatarLink = links.find((a) => new URL(a.href, window.location.href).pathname === '/' + user + '/' && a.querySelector('img'));
        const avatarImage = avatarLink?.querySelector('img') || [...article.querySelectorAll('img')].find((img) => {
            const alt = (img.alt || '').trim().toLowerCase();
            return alt.startsWith(user.toLowerCase()) && /头像|頭像|profile picture|profile photo/.test(alt);
        });
        const avatarUrl = avatarImage?.currentSrc || avatarImage?.src || '';
        // The repeated author link precedes the caption, after the action bar.
        // _aacu is Instagram's caption typography class, observed on the live feed.
        const caption = [...article.querySelectorAll('span._aacu')].find((el) => {
            if (el.querySelector('span._aacu')) return false;
            let node = el.parentElement;
            for (let depth = 0; node && node !== article && depth < 6; depth++, node = node.parentElement) {
                // Never cross from a caption/comment into the whole post.
                if (node.querySelector('section, time, video')) break;
                const localAuthor = [...node.querySelectorAll('a[href]')].find((a) =>
                    a !== author && new URL(a.href, window.location.href).pathname === '/' + user + '/'
                    && (a.compareDocumentPosition(el) & 4));
                if (localAuthor) return true;
            }
            return false;
        });
        const carousel = article.querySelector('[aria-label^="Go to slide"], button[aria-label="Next"], button[aria-label="下一步"]');
        // Offscreen videos may render only a poster. The owning component's
        // already-loaded media type prevents treating those videos as photos.
        let mediaType;
        let isAd = false;
        let fiber = article[Object.keys(article).find((key) => key.startsWith('__reactFiber'))];
        for (let depth = 0; fiber && depth < 24; depth++, fiber = fiber.return) {
            const props = fiber.memoizedProps;
            const metadata = [props?.mediaFragmentKey, props?.queryReference, props?.media]
                .find((value) => value?.code === postUrl.pathname.split('/')[2]);
            if (metadata) {
                if ([1, 2, 8].includes(metadata.media_type)) mediaType = metadata.media_type;
                isAd ||= metadata.is_ad === true || Boolean(metadata.ad_id)
                    || ['ad', 'ads', 'sponsored'].includes(metadata.inventory_source);
            }
            isAd ||= Boolean(props?.adProps?.ad_id || props?.adProps?.adId);
        }
        const firstMedia = [...article.querySelectorAll('img, video')].find((el) => el.tagName === 'VIDEO'
            || !el.closest('a') && !/profile|avatar|头像/i.test(el.alt || '') && !/\/t51\.[^/]+-19\//.test(el.currentSrc || el.src));
        const sponsoredLabel = firstMedia && [...article.querySelectorAll('span, a')].some((el) =>
            !el.children.length && /^(Sponsored|广告|廣告|赞助内容|贊助內容|贊助|推广|推廣)$/i.test(clean(el))
            && (el.compareDocumentPosition(firstMedia) & 4));
        // Only explicit ad metadata or a header label qualifies. Captions may
        // discuss advertising, and an ordinary brand account is not an ad.
        if (isAd || sponsoredLabel) continue;
        const type = mediaType === 8 || carousel ? 'carousel' : mediaType === 2 || article.querySelector('video') || postUrl.pathname.startsWith('/reel/')
            ? 'video' : 'photo';
        const images = [...article.querySelectorAll('img')]
            .filter((img) => !img.closest('a') && !/profile|avatar|头像/i.test(img.alt || '')
                && !/\/t51\.[^/]+-19\//.test(img.currentSrc || img.src))
            .map((img) => img.currentSrc || img.src)
            .filter((src) => /^https?:\/\//.test(src));
        const poster = article.querySelector('video')?.poster;
        if (!images.length && poster && /^https?:\/\//.test(poster)) images.push(poster);
        rows.push({
            user,
            ...(/^https?:\/\//.test(avatarUrl) ? { author_avatar: avatarUrl } : {}),
            caption: clean(caption),
            likes: actionCount(article, ['Like', 'Unlike', '赞', '取消赞', '取消点赞']),
            comments: actionCount(article, ['Comment', '评论']),
            type,
            date: article.querySelector('time')?.getAttribute('datetime') || '',
            url: 'https://www.instagram.com' + postUrl.pathname.replace(/\/?$/, '/'),
            images: [...new Set(images)],
            media: [...new Set(images)].map((url) => ({ type: 'image', url })),
        });
    }
    const text = clean(document.querySelector('main'));
    const empty = /You're all caught up|No posts yet|你已看完所有帖子|暂无帖子/i.test(text);
    return { status: rows.length ? 'ok' : empty ? 'empty' : 'no_rows', rows, articleCount: articles.length };
}

export function buildFeedExtractScript() {
    return `(${extractFeed.toString()})()`;
}

export function buildFeedScrollScript() {
    return `(() => {
        let scroller = document.scrollingElement;
        for (let node = document.querySelector('main article, main [role="article"]'); node; node = node.parentElement) {
            if (node.scrollHeight > node.clientHeight && /^(auto|scroll)$/.test(window.getComputedStyle(node).overflowY)) {
                scroller = node;
                break;
            }
        }
        if (!scroller) return false;
        const before = scroller.scrollTop;
        scroller.scrollBy({ top: Math.max(600, scroller.clientHeight * 0.8), behavior: 'instant' });
        return scroller.scrollTop > before;
    })()`;
}

export { buildFeedImagesScript };

export async function completeFeedImages(page, rows) {
    let requests = 0;
    for (const row of rows) {
        if (row.type === 'photo' && Array.isArray(row.images) && row.images.length) {
            row.media = row.images.map((url) => ({ type: 'image', url }));
            continue;
        }
        if (requests++) await page.wait(0.3);
        const shortcode = new URL(row.url).pathname.split('/')[2];
        let payload;
        try {
            const result = await page.evaluate(buildFeedImagesScript(shortcode));
            payload = result && typeof result === 'object' && 'data' in result ? result.data : result;
        } catch (error) {
            throw new CommandExecutionError(`Failed to read Instagram images for ${shortcode}: ${error instanceof Error ? error.message : error}`);
        }
        if (payload?.status === 'auth') throw new AuthRequiredError('www.instagram.com', 'Instagram requires login to load feed images.');
        if (payload?.status === 'rate_limited') {
            throw new CliError('RATE_LIMITED', 'Instagram limited image metadata requests', 'Wait a few minutes and retry.', EXIT_CODES.TEMPFAIL);
        }
        if (payload?.status !== 'ok' || !Array.isArray(payload.images) || !payload.images.length
            || payload.images.some((url) => typeof url !== 'string' || !/^https?:\/\//.test(url))) {
            throw new CommandExecutionError(`Could not load all Instagram images for ${shortcode}: ${payload?.message || 'malformed image metadata'}`);
        }
        row.images = payload.images;
        if (!Array.isArray(payload.media) || payload.media.length !== payload.images.length
            || payload.media.some((item) => !item || !['image', 'video'].includes(item.type)
                || typeof item.url !== 'string' || !/^https?:\/\//.test(item.url)
                || item.type === 'video' && (typeof item.poster !== 'string' || !/^https?:\/\//.test(item.poster)))) {
            throw new CommandExecutionError(`Could not load all Instagram media for ${shortcode}: malformed media metadata`);
        }
        row.media = payload.media;
    }
    return rows;
}

export async function getInstagramFeed(page, args) {
    const limit = Number(args.limit ?? 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new ArgumentError('instagram feed --limit must be an integer between 1 and 100');
    }
    const rows = new Map();
    let stalled = 0;
    let lastPayload;
    try {
        await page.goto('https://www.instagram.com/', { settleMs: 3000 });
        for (let pass = 0; pass < 60; pass++) {
            const result = await page.evaluate(buildFeedExtractScript());
            const payload = result && typeof result === 'object' && 'data' in result ? result.data : result;
            if (!payload || !Array.isArray(payload.rows) || !['auth', 'ok', 'empty', 'no_rows'].includes(payload.status)) {
                throw new CommandExecutionError('Instagram feed returned malformed extraction payload');
            }
            lastPayload = payload;
            if (payload.status === 'auth') {
                throw new AuthRequiredError('www.instagram.com', 'Log in to Instagram in Chrome before retrying.');
            }
            const previousSize = rows.size;
            for (const row of payload.rows) {
                if (!row || typeof row.url !== 'string' || !row.url || typeof row.user !== 'string' || !row.user) {
                    throw new CommandExecutionError('Instagram feed returned malformed post row');
                }
                rows.set(row.url, row);
                if (rows.size >= limit) break;
            }
            if (rows.size >= limit || payload.status === 'empty') break;
            // Collect on every viewport before scrolling: Instagram may unmount
            // previous cards, so a single final extraction can lose early posts.
            const scrollResult = await page.evaluate(buildFeedScrollScript());
            const moved = scrollResult && typeof scrollResult === 'object' && 'data' in scrollResult
                ? scrollResult.data : scrollResult;
            // A large card can span several viewports. Only consider the feed
            // stalled once we cannot scroll further and no new rows arrived.
            stalled = rows.size === previousSize && !moved ? stalled + 1 : 0;
            if (stalled >= 3) break;
            await page.wait(1);
        }
    } catch (error) {
        if (error instanceof AuthRequiredError || error instanceof CommandExecutionError) throw error;
        throw new CommandExecutionError(`Failed to read Instagram feed: ${error instanceof Error ? error.message : error}`,
            'Check the browser connection and whether Instagram can load its homepage.');
    }
    if (rows.size) {
        const posts = [...rows.values()].slice(0, limit).map((row, i) => ({ index: i + 1, ...row }));
        return completeFeedImages(page, posts);
    }
    if (lastPayload?.status === 'empty') {
        throw new EmptyResultError('instagram feed', 'Instagram shows no more homepage posts for this account.');
    }
    throw new CommandExecutionError('Instagram homepage loaded but no feed posts could be extracted',
        `Visible article count: ${lastPayload?.articleCount ?? 0}. The page may still be loading or its markup may have changed.`);
}

cli({
    site: 'instagram',
    name: 'feed',
    access: 'read',
    description: 'Get posts from your logged-in Instagram home feed',
    domain: 'www.instagram.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [{ name: 'limit', type: 'int', default: 20, help: 'Maximum posts to return (1-100)' }],
    columns: ['index', 'user', 'author_avatar', 'caption', 'likes', 'comments', 'type', 'date', 'url', 'images', 'media'],
    func: getInstagramFeed,
});
