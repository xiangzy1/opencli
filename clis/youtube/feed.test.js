import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './feed.js';

function makePage({ initialData, continuationData, fetchImpl } = {}) {
    const fetchMock = fetchImpl || vi.fn().mockResolvedValue({
        ok: true,
        json: async () => continuationData,
    });

    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(async (script) => {
            const previousWindow = globalThis.window;
            const previousFetch = globalThis.fetch;

            globalThis.window = {
                ytInitialData: initialData,
                ytcfg: {
                    data_: {
                        INNERTUBE_API_KEY: 'test-key',
                        INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: '1.0' } },
                    },
                },
            };
            globalThis.fetch = fetchMock;

            try {
                return await eval(script);
            }
            finally {
                globalThis.window = previousWindow;
                globalThis.fetch = previousFetch;
            }
        }),
        __fetchMock: fetchMock,
    };
}

const initialData = {
    contents: {
        twoColumnBrowseResultsRenderer: {
            tabs: [{
                tabRenderer: {
                    content: {
                        richGridRenderer: {
                            contents: [
                                {
                                    richItemRenderer: {
                                        content: {
                                            videoRenderer: {
                                                videoId: 'first-video',
                                                title: { runs: [{ text: 'First video' }] },
                                                ownerText: { runs: [{ text: 'First channel' }] },
                                                viewCountText: { simpleText: '1K views' },
                                                lengthText: { simpleText: '10:00' },
                                                publishedTimeText: { simpleText: '1 day ago' },
                                                channelThumbnailSupportedRenderers: {
                                                    channelThumbnailWithLinkRenderer: {
                                                        thumbnail: {
                                                            thumbnails: [
                                                                { url: 'https://yt3.ggpht.com/small=s48', width: 48 },
                                                                { url: 'https://yt3.ggpht.com/large=s68', width: 68 },
                                                            ],
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                                {
                                    continuationItemRenderer: {
                                        continuationEndpoint: {
                                            continuationCommand: {
                                                token: 'next-token',
                                            },
                                        },
                                    },
                                },
                            ],
                        },
                    },
                },
            }],
        },
    },
};

const continuationData = {
    onResponseReceivedActions: [{
        appendContinuationItemsAction: {
            continuationItems: [{
                richItemRenderer: {
                    content: {
                        videoRenderer: {
                            videoId: 'second-video',
                            title: { runs: [{ text: 'Second video' }] },
                            ownerText: { runs: [{ text: 'Second channel' }] },
                            viewCountText: { simpleText: '2K views' },
                            lengthText: { simpleText: '11:00' },
                            publishedTimeText: { simpleText: '2 days ago' },
                        },
                    },
                },
            }],
        },
    }],
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('youtube feed', () => {
    it('uses continuation results when the first page is below limit', async () => {
        const page = makePage({ initialData, continuationData });
        const cmd = getRegistry().get('youtube/feed');

        const rows = await cmd.func(page, { limit: 2 });

        expect(page.goto).toHaveBeenCalledWith('https://www.youtube.com');
        expect(page.wait).toHaveBeenCalledWith(3);
        expect(page.__fetchMock).toHaveBeenCalledTimes(1);
        expect(rows).toEqual([
            expect.objectContaining({
                rank: 1,
                title: 'First video',
                video_id: 'first-video',
                // Legacy videoRenderer: avatar comes from channelThumbnailSupportedRenderers,
                // thumbnails smallest-first so the largest wins.
                channel_avatar: 'https://yt3.ggpht.com/large=s68',
                url: 'https://www.youtube.com/watch?v=first-video',
                thumbnail: 'https://i.ytimg.com/vi/first-video/hqdefault.jpg',
            }),
            expect.objectContaining({
                rank: 2,
                title: 'Second video',
                video_id: 'second-video',
                url: 'https://www.youtube.com/watch?v=second-video',
                thumbnail: 'https://i.ytimg.com/vi/second-video/hqdefault.jpg',
            }),
        ]);
    });

    it('navigates to the subscriptions feed when type=subscribed', async () => {
        const page = makePage({ initialData, continuationData });
        const cmd = getRegistry().get('youtube/feed');

        const rows = await cmd.func(page, { type: 'subscribed', limit: 2 });

        expect(page.goto).toHaveBeenCalledWith('https://www.youtube.com/feed/subscriptions');
        // Same richGrid extraction + continuation pagination reused for both feed types.
        expect(page.__fetchMock).toHaveBeenCalledTimes(1);
        expect(rows).toEqual([
            expect.objectContaining({
                rank: 1,
                video_id: 'first-video',
                url: 'https://www.youtube.com/watch?v=first-video',
                thumbnail: 'https://i.ytimg.com/vi/first-video/hqdefault.jpg',
            }),
            expect.objectContaining({
                rank: 2,
                video_id: 'second-video',
                url: 'https://www.youtube.com/watch?v=second-video',
                thumbnail: 'https://i.ytimg.com/vi/second-video/hqdefault.jpg',
            }),
        ]);
    });

    it('reads the channel avatar from the lockup view model format', async () => {
        const lockupData = {
            contents: {
                twoColumnBrowseResultsRenderer: {
                    tabs: [{
                        tabRenderer: {
                            content: {
                                richGridRenderer: {
                                    contents: [{
                                        richItemRenderer: {
                                            content: {
                                                lockupViewModel: {
                                                    contentId: 'lockup-video',
                                                    contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
                                                    metadata: {
                                                        lockupMetadataViewModel: {
                                                            title: { content: 'Lockup video' },
                                                            image: {
                                                                decoratedAvatarViewModel: {
                                                                    avatar: {
                                                                        avatarViewModel: {
                                                                            image: {
                                                                                sources: [
                                                                                    { url: 'https://yt3.ggpht.com/lockup=s68', width: 68 },
                                                                                ],
                                                                            },
                                                                        },
                                                                    },
                                                                },
                                                            },
                                                            metadata: {
                                                                contentMetadataViewModel: {
                                                                    metadataRows: [{
                                                                        metadataParts: [
                                                                            { text: { content: 'Lockup channel' } },
                                                                            { text: { content: '3K views' } },
                                                                            { text: { content: '5 days ago' } },
                                                                        ],
                                                                    }],
                                                                },
                                                            },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    }],
                                },
                            },
                        },
                    }],
                },
            },
        };
        const page = makePage({ initialData: lockupData });
        const rows = await getRegistry().get('youtube/feed').func(page, { limit: 1 });
        expect(rows[0]).toMatchObject({
            title: 'Lockup video',
            channel: 'Lockup channel',
            channel_avatar: 'https://yt3.ggpht.com/lockup=s68',
            video_id: 'lockup-video',
        });
    });

    // 订阅页卡片的元信息行顺序不固定：合作视频多一段合作者，直播/预告没有观看数。
    // 以前按固定下标取会把观看数当成发布时间，这里锁定按内容识别的行为。
    it('picks channel / collaborators / views / published by content, not by position', async () => {
        const lockup = (contentId, title, parts) => ({
            richItemRenderer: {
                content: {
                    lockupViewModel: {
                        contentId,
                        contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
                        metadata: {
                            lockupMetadataViewModel: {
                                title: { content: title },
                                metadata: {
                                    contentMetadataViewModel: {
                                        metadataRows: [{ metadataParts: parts.map((content) => ({ text: { content } })) }],
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
        const initialData = {
            contents: {
                twoColumnBrowseResultsRenderer: {
                    tabs: [{
                        tabRenderer: {
                            content: {
                                richGridRenderer: {
                                    contents: [
                                        lockup('collab', 'Collab video', ['Bambu Lab', '和Scott Yu-Jan', '4378', '2小时前']),
                                        lockup('upcoming', 'Upcoming video', ['Visual Studio Code', '预定发布时间：2026/12/11 00:00']),
                                        lockup('live', 'Live video', ['Some channel', '12 views', 'Streaming live']),
                                        lockup('plain', 'Plain video', ['Some channel', '1.2K views', '14 hours ago']),
                                    ],
                                },
                            },
                        },
                    }],
                },
            },
        };
        const page = makePage({ initialData });
        const rows = await getRegistry().get('youtube/feed').func(page, { limit: 4 });

        expect(rows.map(({ video_id, channel, collaborators, views, published }) => ({ video_id, channel, collaborators, views, published }))).toEqual([
            { video_id: 'collab', channel: 'Bambu Lab', collaborators: '和Scott Yu-Jan', views: '4378', published: '2小时前' },
            { video_id: 'upcoming', channel: 'Visual Studio Code', collaborators: '', views: '', published: '预定发布时间：2026/12/11 00:00' },
            { video_id: 'live', channel: 'Some channel', collaborators: '', views: '12 views', published: 'Streaming live' },
            { video_id: 'plain', channel: 'Some channel', collaborators: '', views: '1.2K views', published: '14 hours ago' },
        ]);
    });
});
