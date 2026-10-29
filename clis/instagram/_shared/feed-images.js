// Fetch one post's full media list. DOM carousels render only nearby slides and
// can even start on slide two; carousel_media is the original publication order.
async function fetchFeedImages(shortcode) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let mediaId = 0n;
    for (const character of shortcode) {
        const digit = alphabet.indexOf(character);
        if (digit < 0) return { status: 'error', message: 'Invalid Instagram shortcode' };
        mediaId = mediaId * 64n + BigInt(digit);
    }
    const response = await fetch('/api/v1/media/' + mediaId + '/info/', {
        credentials: 'include', headers: { 'X-IG-App-ID': '936619743392459', Accept: 'application/json' },
    });
    if (response.status === 429) return { status: 'rate_limited' };
    if (response.status === 401 || response.status === 403) return { status: 'auth' };
    if (!response.ok) return { status: 'error', message: 'Instagram media info HTTP ' + response.status };
    const data = await response.json();
    if (data.require_login) return { status: 'auth' };
    if (/wait a few minutes|rate limit/i.test(data.message || '')) return { status: 'rate_limited' };
    const media = data.items?.[0];
    if (data.status && data.status !== 'ok' || !media || media.code !== shortcode) {
        return { status: 'error', message: 'Instagram media info returned no matching post' };
    }
    const nodes = media.media_type === 8 ? media.carousel_media : [media];
    if (!Array.isArray(nodes) || !nodes.length) return { status: 'error', message: 'Instagram carousel returned no media' };
    const images = [];
    const orderedMedia = [];
    for (const node of nodes) {
        const candidates = node?.image_versions2?.candidates;
        const best = Array.isArray(candidates) ? candidates.filter((c) => typeof c?.url === 'string' && /^https?:\/\//.test(c.url))
            .sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0))[0] : undefined;
        if (!best) return { status: 'error', message: 'Instagram media item is missing image candidates' };
        // Videos contribute their cover image, retaining their carousel position.
        images.push(best.url);
        if (node.media_type === 2) {
            const videos = node.video_versions;
            const video = Array.isArray(videos) ? videos.filter((v) => typeof v?.url === 'string' && /^https?:\/\//.test(v.url))
                .sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0))[0] : undefined;
            if (!video) return { status: 'error', message: 'Instagram video is missing playable renditions' };
            orderedMedia.push({ type: 'video', url: video.url, poster: best.url });
        } else {
            orderedMedia.push({ type: 'image', url: best.url });
        }
    }
    return { status: 'ok', images, media: orderedMedia };
}

export function buildFeedImagesScript(shortcode) {
    return `(${fetchFeedImages.toString()})(${JSON.stringify(shortcode)})`;
}
