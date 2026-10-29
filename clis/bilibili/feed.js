import { cli, Strategy } from '@jackwener/opencli/registry';
import { apiGet, httpsUrl, parseCountText, parseDurationText, payloadData, resolveUid, stripHtml } from './utils.js';

/** Map bilibili dynamic type to readable short name */
const TYPE_MAP = {
    DYNAMIC_TYPE_AV: 'video',
    DYNAMIC_TYPE_UGC_SEASON: 'video',
    DYNAMIC_TYPE_DRAW: 'draw',
    DYNAMIC_TYPE_ARTICLE: 'article',
    DYNAMIC_TYPE_FORWARD: 'forward',
    DYNAMIC_TYPE_WORD: 'text',
    DYNAMIC_TYPE_LIVE_RCMD: 'live',
    DYNAMIC_TYPE_PGC: 'bangumi',
};

/** Collect picture URLs from a dynamic's major module (draw images, video/article covers, opus pictures). */
function collectImages(major) {
    const urls = [];
    if (major.draw?.items?.length) {
        for (const img of major.draw.items) {
            if (img.src) urls.push(img.src);
        }
    }
    if (major.archive?.cover) urls.push(major.archive.cover);
    if (major.ugc_season?.cover) urls.push(major.ugc_season.cover);
    if (major.article?.covers?.length) urls.push(...major.article.covers);
    if (major.opus?.pics?.length) {
        for (const pic of major.opus.pics) {
            if (pic.url) urls.push(pic.url);
        }
    }
    return urls;
}

function parseItem(item) {
    const modules = item.modules ?? {};
    const authorModule = modules.module_author ?? {};
    const dynamicModule = modules.module_dynamic ?? {};
    const major = dynamicModule.major ?? {};
    const stat = modules.module_stat ?? {};

    let title = '';
    let url = item.id_str ? `https://t.bilibili.com/${item.id_str}` : '';
    const archive = major.archive ?? major.ugc_season ?? null;
    const itemType = TYPE_MAP[item.type] ?? (archive ? 'video' : (item.type ?? ''));

    // video
    if (archive) {
        title = archive.title ?? '';
        url = archive.jump_url ? httpsUrl(archive.jump_url) : url;
    }
    // article
    if (!title && major.article) {
        title = major.article.title ?? '';
        url = major.article.jump_url ? httpsUrl(major.article.jump_url) : url;
    }
    // opus (new rich-text dynamics carry their own title)
    if (!title && major.opus?.title) {
        title = major.opus.title;
    }
    // text content in desc
    if (!title && dynamicModule.desc?.text) {
        title = stripHtml(dynamicModule.desc.text).slice(0, 60).trim();
    }
    if (!title && major.opus?.summary?.text) {
        title = stripHtml(major.opus.summary.text).slice(0, 60).trim();
    }
    // draw — pure image post, consumers render the images themselves
    if (!title && major.draw) {
        title = '[图文]';
    }
    // VIP only content
    if (!title && item.basic?.is_only_fans) {
        title = '[充电专属]';
    }
    // forward
    if (!title && item.type === 'DYNAMIC_TYPE_FORWARD') {
        title = '[转发动态]';
    }
    // final fallback
    if (!title) {
        title = `[${itemType || '动态'}]`;
    }

    const time = authorModule.pub_time ?? '';
    const likes = stat.like?.count ?? 0;
    const comments = stat.comment?.count ?? 0;

    // 视频动态在 major.archive / major.ugc_season 里自带时长 / 播放 / 封面 / bvid，不用再去打 view 接口。
    // 非视频动态（专栏、图文、纯文字）这些字段就是空的，按 0 / '' 输出。
    const archiveData = archive ?? {};
    const durationText = archiveData.duration_text ?? '';

    // Full text body: opus-style dynamics keep it in summary, others in desc.
    let content = '';
    if (major.opus?.summary?.text) content = stripHtml(major.opus.summary.text);
    if (!content && dynamicModule.desc?.text) content = stripHtml(dynamicModule.desc.text);
    // forward — append the original dynamic's text
    if (item.orig) {
        const origDynamic = item.orig.modules?.module_dynamic ?? {};
        const origMajor = origDynamic.major ?? {};
        const origText = origMajor.opus?.summary?.text || origDynamic.desc?.text || '';
        if (origText) {
            const origAuthor = item.orig.modules?.module_author?.name ?? '';
            const quoted = stripHtml(origText);
            content = content ? `${content}\n\n// @${origAuthor}: ${quoted}` : `// @${origAuthor}: ${quoted}`;
        }
    }

    // Own pictures plus the forwarded original's, newline separated.
    const images = [...collectImages(major)];
    if (item.orig?.modules?.module_dynamic?.major) {
        images.push(...collectImages(item.orig.modules.module_dynamic.major));
    }

    return {
        title,
        url,
        itemType,
        author: authorModule.name ?? '',
        mid: String(authorModule.mid ?? ''),
        face: httpsUrl(authorModule.face),
        // time 是 "3小时前" / "昨天 20:15" 这种展示串（保留不动），pub_ts 才是 unix 秒。
        // 实测接口把 pub_ts 返成字符串（"1788582060"），统一成数字。
        time,
        pub_ts: Number(authorModule.pub_ts) || 0,
        bvid: archiveData.bvid ?? '',
        cover: httpsUrl(archiveData.cover),
        duration: durationText,
        duration_sec: parseDurationText(durationText),
        // stat.play / stat.danmaku 是 "1.2万" 这种展示文本，解析成数字。
        plays: parseCountText(archiveData.stat?.play),
        danmaku: parseCountText(archiveData.stat?.danmaku),
        desc: archiveData.desc ?? '',
        only_fans: !!item.basic?.is_only_fans,
        likes,
        comments,
        content,
        images: images.join('\n'),
    };
}

cli({
    site: 'bilibili',
    name: 'feed',
    access: 'read',
    description: '动态时间线（不传 uid 查关注时间线，传 uid 查指定用户动态）',
    domain: 'www.bilibili.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'uid', positional: true, required: false, help: '用户 UID 或用户名（不传则显示关注时间线）' },
        { name: 'limit', type: 'int', default: 20, help: 'Max results to return' },
        { name: 'type', default: 'all', help: 'Filter: all, video, article, draw, text' },
        { name: 'pages', type: 'int', default: 1, help: 'Number of pages to fetch (each ~20 items)' },
    ],
    columns: ['rank', 'time', 'pub_ts', 'author', 'mid', 'title', 'type', 'duration', 'duration_sec', 'plays', 'danmaku', 'likes', 'url', 'bvid', 'cover', 'face', 'desc', 'only_fans', 'images', 'content'],
    func: async (page, kwargs) => {
        const maxResults = Number(kwargs.limit) || 20;
        const maxPages = Number(kwargs.pages) || 1;
        const filterType = kwargs.type === 'all' ? '' : (kwargs.type ?? '');

        const isUserFeed = !!kwargs.uid;
        const uid = isUserFeed ? await resolveUid(page, String(kwargs.uid)) : null;

        const rows = [];
        let offset = '';

        for (let p = 0; p < maxPages; p++) {
            if (rows.length >= maxResults) break;

            let payload;
            if (isUserFeed) {
                const params = { host_mid: uid, timezone_offset: -480, features: 'itemOpusStyle' };
                if (offset) params.offset = offset;
                payload = await apiGet(page, '/x/polymer/web-dynamic/v1/feed/space', { params });
            } else {
                const params = {
                    timezone_offset: -480,
                    type: filterType || 'all',
                    page: p + 1,
                    // Without this, new draw dynamics hide their text and pics inside opus.
                    features: 'itemOpusStyle',
                };
                if (offset) params.offset = offset;
                payload = await apiGet(page, '/x/polymer/web-dynamic/v1/feed/all', { params });
            }

            const data = payloadData(payload) ?? {};
            const items = data.items ?? [];
            if (items.length === 0) break;

            for (const item of items) {
                if (rows.length >= maxResults) break;
                const parsed = parseItem(item);
                if (filterType && parsed.itemType !== filterType) continue;
                rows.push({
                    rank: rows.length + 1,
                    time: parsed.time,
                    pub_ts: parsed.pub_ts,
                    author: parsed.author,
                    mid: parsed.mid,
                    title: parsed.title,
                    type: parsed.itemType,
                    duration: parsed.duration,
                    duration_sec: parsed.duration_sec,
                    plays: parsed.plays,
                    danmaku: parsed.danmaku,
                    likes: parsed.likes,
                    url: parsed.url,
                    bvid: parsed.bvid,
                    cover: parsed.cover,
                    face: parsed.face,
                    desc: parsed.desc,
                    only_fans: parsed.only_fans,
                    images: parsed.images,
                    content: parsed.content,
                });
            }

            offset = data.offset ?? items[items.length - 1]?.id_str ?? '';
            if (!offset || !data.has_more) break;
        }

        return rows;
    },
});

cli({
    site: 'bilibili',
    name: 'feed-detail',
    access: 'read',
    description: '查看 Bilibili 动态详情（支持充电专属内容）',
    domain: 'www.bilibili.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'id', positional: true, required: true, help: '动态 ID（从 feed 命令的 url 中获取）' },
    ],
    columns: ['field', 'value'],
    func: async (page, kwargs) => {
        const id = String(kwargs.id);
        const payload = await apiGet(page, '/x/polymer/web-dynamic/v1/detail', {
            params: { id, timezone_offset: -480, features: 'itemOpusStyle' },
        });

        const rows = [];
        const data = payloadData(payload);
        const item = data?.item;
        if (!item) {
            rows.push({ field: 'error', value: '动态不存在或无权查看'});
            return rows;
        }

        const modules = item.modules ?? {};
        const author = modules.module_author ?? {};
        const dynamicModule = modules.module_dynamic ?? {};
        const major = dynamicModule.major ?? {};
        const stat = modules.module_stat ?? {};

        rows.push({ field: 'id', value: item.id_str ?? id });
        rows.push({ field: 'author', value: author.name ?? '' });
        rows.push({ field: 'time', value: author.pub_time ?? '' });
        rows.push({ field: 'type', value: TYPE_MAP[item.type] ?? item.type ?? '' });

        // text content
        if (dynamicModule.desc?.text) {
            rows.push({ field: 'text', value: stripHtml(dynamicModule.desc.text) });
        }

        // video
        if (major.archive) {
            rows.push({ field: 'video_title', value: major.archive.title ?? '' });
            rows.push({ field: 'video_desc', value: major.archive.desc ?? '' });
            rows.push({ field: 'video_url', value: major.archive.jump_url ? `https:${major.archive.jump_url}` : '' });
            rows.push({ field: 'play', value: String(major.archive.stat?.play ?? '') });
            rows.push({ field: 'danmaku', value: String(major.archive.stat?.danmaku ?? '') });
        }

        // article
        if (major.article) {
            rows.push({ field: 'article_title', value: major.article.title ?? '' });
            rows.push({ field: 'article_url', value: major.article.jump_url ? `https:${major.article.jump_url}` : '' });
        }

        // draw (images)
        if (major.draw?.items?.length) {
            rows.push({ field: 'images', value: major.draw.items.map((img) => img.src).join('\n') });
        }

        // opus (rich text, some dynamics use this)
        if (major.opus?.summary?.text) {
            rows.push({ field: 'opus_text', value: stripHtml(major.opus.summary.text) });
        }
        if (major.opus?.title) {
            rows.push({ field: 'opus_title', value: major.opus.title });
        }

        // forward - show original dynamic info
        if (item.orig) {
            const origAuthor = item.orig.modules?.module_author?.name ?? '';
            const origDesc = item.orig.modules?.module_dynamic?.desc?.text ?? '';
            rows.push({ field: 'forward_from', value: origAuthor });
            if (origDesc) rows.push({ field: 'forward_text', value: stripHtml(origDesc).slice(0, 200) });
        }

        // stats
        rows.push({ field: 'likes', value: String(stat.like?.count ?? 0) });
        rows.push({ field: 'comments', value: String(stat.comment?.count ?? 0) });
        rows.push({ field: 'forwards', value: String(stat.forward?.count ?? 0) });
        rows.push({ field: 'url', value: `https://t.bilibili.com/${item.id_str ?? id}` });

        return rows;
    },
});
