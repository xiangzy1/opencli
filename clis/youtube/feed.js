/**
 * YouTube feed — homepage recommended videos.
 * Reads ytInitialData from the homepage directly (personalized, no separate API call needed).
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

cli({
    site: 'youtube',
    name: 'feed',
    access: 'read',
    description: 'Get YouTube feed: homepage recommendations or videos from subscribed channels',
    domain: 'www.youtube.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max videos to return (default 20, max 100)' },
        { name: 'type', default: 'home', help: 'Feed type: home (homepage recommendations) or subscribed (videos from your subscribed channels)' },
    ],
    columns: ['rank', 'title', 'channel', 'collaborators', 'channel_avatar', 'video_id', 'views', 'duration', 'published', 'url', 'thumbnail'],
    func: async (page, kwargs) => {
        const limit = Math.min(kwargs.limit || 20, 100);
        const feedType = kwargs.type || 'home';
        const feedUrl = feedType === 'subscribed'
            ? 'https://www.youtube.com/feed/subscriptions'
            : 'https://www.youtube.com';
        await page.goto(feedUrl);
        await page.wait(3);
        const data = await page.evaluate(`
      (async () => {
        const d = window.ytInitialData;
        if (!d) return { error: 'YouTube data not found — are you logged in?' };

        const limit = ${limit};
        const cfg = window.ytcfg?.data_ || {};
        const apiKey = cfg.INNERTUBE_API_KEY;
        const context = cfg.INNERTUBE_CONTEXT;

        // YouTube 订阅页里每张卡片的元信息行，顺序不固定：
        //   [频道名, (和xxx / 以及另外 N 位联合创作者)?, 观看数?, (xx前 / 预定发布时间…)?]
        // 合作视频会多一段合作者，直播/预告没有观看数但有「预定发布时间」，
        // 所以不能按位置取，要按内容判断。
        const RELATIVE_TIME_RE = /(?:\\bago|前|[后後]|just\\s*now|刚刚|剛剛)$/i;
        const SCHEDULED_RE = /^(?:预定发布时间|scheduled\\s*(?:for|at)|premieres?\\s*(?:at|on))/i;
        const LIVE_RE = /^(?:live|streaming\\b.*|streamed\\b.*|正在直播|首播\\s*(?:中|ing)?|直播\\s*(?:中|ing)?)\\s*$/i;
        const VIEW_COUNT_RE = /^(?:[\\d.,]+\\s*(?:[km]\\b|万|亿|千)?(?:\\s*(?:次观看|回視聴|views|visualiza\\w*))?|no\\s+views)\\s*$/i;
        function pickMetadata(parts) {
          const rest = parts.filter(Boolean);
          const take = (re) => {
            const i = rest.findIndex(p => re.test(p));
            return i === -1 ? '' : rest.splice(i, 1)[0];
          };
          const published = take(RELATIVE_TIME_RE) || take(SCHEDULED_RE) || take(LIVE_RE);
          const views = take(VIEW_COUNT_RE);
          const channel = rest.shift() || '';
          const collaborators = rest.join(' ').trim();
          return { channel, collaborators, views, published };
        }

        function extractFromItem(item) {
          // Modern lockupViewModel format
          const lvm = item.richItemRenderer?.content?.lockupViewModel;
          if (lvm && lvm.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
            const meta = lvm.metadata?.lockupMetadataViewModel;
            const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
            const parts = rows.flatMap(r => (r.metadataParts || []).map(p => p.text?.content || '').filter(Boolean));
            const picked = pickMetadata(parts);
            let duration = '';
            for (const ov of (lvm.contentImage?.thumbnailViewModel?.overlays || [])) {
              for (const b of (ov.thumbnailBottomOverlayViewModel?.badges || [])) {
                if (b.thumbnailBadgeViewModel?.text) duration = b.thumbnailBadgeViewModel.text;
              }
            }
            // Channel avatar: lockup keeps it under decoratedAvatarViewModel.
            // Sources are smallest-first, so the last one is the largest.
            const lockupAvatars = meta?.image?.decoratedAvatarViewModel?.avatar
              ?.avatarViewModel?.image?.sources
              || meta?.image?.avatarViewModel?.image?.sources
              || [];
            let channel_avatar = lockupAvatars[lockupAvatars.length - 1]?.url || '';
            if (channel_avatar.startsWith('//')) {
              channel_avatar = 'https:' + channel_avatar;
            }
            const tns = lvm.contentImage?.thumbnailViewModel?.image?.sources
              || lvm.contentImage?.thumbnailViewModel?.thumbnail?.thumbnails
              || lvm.contentImage?.thumbnailViewModel?.image?.thumbnails;
            let thumbnail = (Array.isArray(tns) && tns.length > 0) ? (tns[tns.length - 1].url || '') : '';
            if (!thumbnail && lvm.contentId) {
              thumbnail = 'https://i.ytimg.com/vi/' + lvm.contentId + '/hqdefault.jpg';
            }
            if (thumbnail.startsWith('//')) {
              thumbnail = 'https:' + thumbnail;
            }
            return {
              title: meta?.title?.content || '',
              channel: picked.channel,
              collaborators: picked.collaborators,
              channel_avatar,
              views: picked.views,
              duration,
              published: picked.published,
              video_id: lvm.contentId,
              thumbnail,
            };
          }

          // Legacy videoRenderer format
          const v = item.richItemRenderer?.content?.videoRenderer || item.videoRenderer;
          if (v?.videoId) {
            // Legacy renderer keeps the avatar under channelThumbnailSupportedRenderers
            // (smallest-first, so the last thumbnail is the largest).
            const rendererAvatars = v.channelThumbnailSupportedRenderers
              ?.channelThumbnailWithLinkRenderer?.thumbnail?.thumbnails || [];
            let channel_avatar = rendererAvatars[rendererAvatars.length - 1]?.url || '';
            if (channel_avatar.startsWith('//')) {
              channel_avatar = 'https:' + channel_avatar;
            }
            const tns = v.thumbnail?.thumbnails;
            let thumbnail = (Array.isArray(tns) && tns.length > 0) ? (tns[tns.length - 1].url || '') : '';
            if (!thumbnail) {
              thumbnail = 'https://i.ytimg.com/vi/' + v.videoId + '/hqdefault.jpg';
            }
            if (thumbnail.startsWith('//')) {
              thumbnail = 'https:' + thumbnail;
            }
            return {
              title: v.title?.runs?.[0]?.text || '',
              channel: v.ownerText?.runs?.[0]?.text || v.shortBylineText?.runs?.[0]?.text || '',
              collaborators: '',
              channel_avatar,
              views: v.viewCountText?.simpleText || v.shortViewCountText?.simpleText || '',
              duration: v.lengthText?.simpleText || '',
              published: v.publishedTimeText?.simpleText || '',
              video_id: v.videoId,
              thumbnail,
            };
          }
          return null;
        }

        const tabs = d.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
        const richContents = tabs[0]?.tabRenderer?.content?.richGridRenderer?.contents || [];

        const videos = [];
        for (const item of richContents) {
          if (videos.length >= limit) break;
          const v = extractFromItem(item);
          if (v?.video_id) {
            videos.push({ rank: videos.length + 1, ...v, url: 'https://www.youtube.com/watch?v=' + v.video_id });
          }
        }

        // Pagination
        if (videos.length < limit && apiKey && context) {
          let contItem = richContents[richContents.length - 1];
          while (videos.length < limit && contItem?.continuationItemRenderer) {
            const token = contItem.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
            if (!token) break;
            const resp = await fetch('/youtubei/v1/browse?key=' + apiKey + '&prettyPrint=false', {
              method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ context, continuation: token }),
            });
            if (!resp.ok) break;
            const contData = await resp.json();
            const newItems = contData.onResponseReceivedActions?.[0]?.appendContinuationItemsAction?.continuationItems || [];
            if (!newItems.length) break;
            for (const item of newItems) {
              if (videos.length >= limit) break;
              const v = extractFromItem(item);
              if (v?.video_id) {
                videos.push({ rank: videos.length + 1, ...v, url: 'https://www.youtube.com/watch?v=' + v.video_id });
              }
            }
            contItem = newItems[newItems.length - 1];
          }
        }

        return videos;
      })()
    `);
        if (!Array.isArray(data)) {
            const errMsg = data && typeof data === 'object' ? String(data.error || '') : '';
            throw new CommandExecutionError(errMsg || 'Failed to fetch YouTube feed');
        }
        if (data.length === 0) {
            const hint = feedType === 'subscribed'
                ? 'No subscription videos found — make sure you are logged in and subscribe to channels'
                : undefined;
            throw new EmptyResultError('youtube feed', hint);
        }
        return data;
    },
});
