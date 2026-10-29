import { describe, expect, it } from 'vitest';
import { __test__ } from './timeline.js';
describe('twitter timeline helpers', () => {
    it('builds for-you variables with withCommunity', () => {
        expect(__test__.buildTimelineVariables('for-you', 20)).toEqual({
            count: 20,
            includePromotedContent: false,
            latestControlAvailable: true,
            requestContext: 'launch',
            withCommunity: true,
        });
    });
    it('builds following variables with seenTweetIds instead of withCommunity', () => {
        expect(__test__.buildTimelineVariables('following', 20, 'cursor-1')).toEqual({
            count: 20,
            includePromotedContent: false,
            latestControlAvailable: true,
            requestContext: 'launch',
            seenTweetIds: [],
            cursor: 'cursor-1',
        });
    });
    it('encodes variables into timeline url', () => {
        const url = __test__.buildHomeTimelineUrl('query123', 'HomeLatestTimeline', {
            count: 20,
            seenTweetIds: [],
        });
        expect(url).toContain('/i/api/graphql/query123/HomeLatestTimeline');
        expect(url).toContain('variables=');
        expect(url).toContain('features=');
        expect(decodeURIComponent(url)).toContain('"seenTweetIds":[]');
    });
    it('parses tweets and bottom cursor from home timeline payload', () => {
        const payload = {
            data: {
                home: {
                    home_timeline_urt: {
                        instructions: [
                            {
                                entries: [
                                    {
                                        entryId: 'tweet-1',
                                        content: {
                                            itemContent: {
                                                tweet_results: {
                                                    result: {
                                                        rest_id: '1',
                                                        legacy: {
                                                            full_text: 'hello',
                                                            favorite_count: 3,
                                                            retweet_count: 2,
                                                            reply_count: 1,
                                                            created_at: 'now',
                                                        },
                                                        core: {
                                                            user_results: {
                                                                result: {
                                                                    legacy: {
                                                                        screen_name: 'alice',
                                                                        profile_image_url_https: 'https://pbs.twimg.com/profile_images/1/alice_normal.jpg',
                                                                        description: 'Timeline author bio',
                                                                    },
                                                                },
                                                            },
                                                        },
                                                        views: {
                                                            count: '9',
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                    {
                                        entryId: 'cursor-bottom-1',
                                        content: {
                                            entryType: 'TimelineTimelineCursor',
                                            cursorType: 'Bottom',
                                            value: 'cursor-next',
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        };
        const result = __test__.parseHomeTimeline(payload, new Set());
        expect(result.nextCursor).toBe('cursor-next');
        expect(result.tweets).toHaveLength(1);
        expect(result.tweets[0]).toMatchObject({
            id: '1',
            author: 'alice',
            author_avatar: 'https://pbs.twimg.com/profile_images/1/alice_400x400.jpg',
            author_verified: false,
            bio: 'Timeline author bio',
            text: 'hello',
            likes: 3,
            retweets: 2,
            replies: 1,
            views: 9,
            created_at: 'now',
            url: 'https://x.com/alice/status/1',
        });
    });
    it('unwraps pure retweets to the original tweet (full text, media, counts) and records the retweeter', () => {
        const payload = {
            data: {
                home: {
                    home_timeline_urt: {
                        instructions: [
                            {
                                entries: [
                                    {
                                        entryId: 'tweet-rt',
                                        content: {
                                            itemContent: {
                                                tweet_results: {
                                                    result: {
                                                        rest_id: 'rt-1',
                                                        core: {
                                                            user_results: {
                                                                result: {
                                                                    legacy: {
                                                                        screen_name: 'carol',
                                                                        name: 'Carol',
                                                                    },
                                                                },
                                                            },
                                                        },
                                                        legacy: {
                                                            full_text: 'RT @bob: look at this photo https://t.co/abc',
                                                            created_at: 'rt time',
                                                            retweeted_status_result: {
                                                                result: {
                                                                    rest_id: 'orig-1',
                                                                    core: {
                                                                        user_results: {
                                                                            result: {
                                                                                legacy: {
                                                                                    screen_name: 'bob',
                                                                                    profile_image_url_https: 'https://pbs.twimg.com/profile_images/2/bob_normal.jpg',
                                                                                    name: 'Bob',
                                                                                    description: "Bob's bio",
                                                                                },
                                                                            },
                                                                        },
                                                                    },
                                                                    legacy: {
                                                                        full_text: 'look at this photo',
                                                                        created_at: 'orig time',
                                                                        favorite_count: 10,
                                                                        retweet_count: 4,
                                                                        reply_count: 2,
                                                                        extended_entities: {
                                                                            media: [
                                                                                {
                                                                                    type: 'photo',
                                                                                    media_url_https: 'https://pbs.twimg.com/media/abc.jpg',
                                                                                },
                                                                            ],
                                                                        },
                                                                    },
                                                                    views: { count: '100' },
                                                                },
                                                            },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        };
        const result = __test__.parseHomeTimeline(payload, new Set());
        expect(result.tweets).toHaveLength(1);
        expect(result.tweets[0]).toMatchObject({
            id: 'orig-1',
            author: 'bob',
            author_avatar: 'https://pbs.twimg.com/profile_images/2/bob_400x400.jpg',
            name: 'Bob',
            bio: "Bob's bio",
            text: 'look at this photo',
            likes: 10,
            retweets: 4,
            replies: 2,
            views: 100,
            created_at: 'orig time',
            url: 'https://x.com/bob/status/orig-1',
            is_retweet: true,
            retweeted_by: 'carol',
            has_media: true,
            media_urls: ['https://pbs.twimg.com/media/abc.jpg'],
            media_posters: ['https://pbs.twimg.com/media/abc.jpg'],
        });
    });
    it('surfaces X Article preview (title, url, cover) for article tweets', () => {
        const payload = {
            data: {
                home: {
                    home_timeline_urt: {
                        instructions: [
                            {
                                entries: [
                                    {
                                        entryId: 'tweet-article',
                                        content: {
                                            itemContent: {
                                                tweet_results: {
                                                    result: {
                                                        rest_id: 'a-1',
                                                        core: { user_results: { result: { legacy: { screen_name: 'dotey', name: '宝玉' } } } },
                                                        legacy: {
                                                            full_text: 'https://t.co/LAqhpQoY1c',
                                                            entities: {
                                                                urls: [
                                                                    {
                                                                        url: 'https://t.co/LAqhpQoY1c',
                                                                        expanded_url: 'https://x.com/i/article/999',
                                                                    },
                                                                ],
                                                            },
                                                        },
                                                        article: {
                                                            article_results: {
                                                                result: {
                                                                    title: 'Claude Opus 5.5 是怎么做出视频的',
                                                                    cover_media: {
                                                                        media_info: { original_img_url: 'https://pbs.twimg.com/media/cover.jpg' },
                                                                    },
                                                                },
                                                            },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        };
        const result = __test__.parseHomeTimeline(payload, new Set());
        expect(result.tweets).toHaveLength(1);
        expect(result.tweets[0].article).toEqual({
            title: 'Claude Opus 5.5 是怎么做出视频的',
            url: 'https://x.com/i/article/999',
            cover_image: 'https://pbs.twimg.com/media/cover.jpg',
        });
    });
    it('expands t.co links to real URLs and strips media short links in tweet text', () => {
        const payload = {
            data: {
                home: {
                    home_timeline_urt: {
                        instructions: [
                            {
                                entries: [
                                    {
                                        entryId: 'tweet-links',
                                        content: {
                                            itemContent: {
                                                tweet_results: {
                                                    result: {
                                                        rest_id: 'l-1',
                                                        core: { user_results: { result: { legacy: { screen_name: 'alice' } } } },
                                                        legacy: {
                                                            full_text: 'post https://t.co/link1 and photo https://t.co/media1',
                                                            created_at: 'now',
                                                            entities: {
                                                                urls: [
                                                                    { url: 'https://t.co/link1', expanded_url: 'https://example.com/post' },
                                                                ],
                                                                media: [
                                                                    { type: 'photo', url: 'https://t.co/media1', media_url_https: 'https://pbs.twimg.com/media/x.jpg' },
                                                                ],
                                                            },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        };
        const result = __test__.parseHomeTimeline(payload, new Set());
        expect(result.tweets).toHaveLength(1);
        expect(result.tweets[0].text).toBe('post https://example.com/post and photo');
        expect(result.tweets[0].media_urls).toEqual(['https://pbs.twimg.com/media/x.jpg']);
    });
    it('collapses an original tweet and its retweet into one entry, keyed on the original id', () => {
        const originalResult = {
            rest_id: 'orig-1',
            core: { user_results: { result: { legacy: { screen_name: 'bob', name: 'Bob' } } } },
            legacy: { full_text: 'original text', created_at: 'orig time' },
        };
        const payload = {
            data: {
                home: {
                    home_timeline_urt: {
                        instructions: [
                            {
                                entries: [
                                    {
                                        entryId: 'tweet-orig',
                                        content: { itemContent: { tweet_results: { result: originalResult } } },
                                    },
                                    {
                                        entryId: 'tweet-rt',
                                        content: {
                                            itemContent: {
                                                tweet_results: {
                                                    result: {
                                                        rest_id: 'rt-1',
                                                        core: { user_results: { result: { legacy: { screen_name: 'carol' } } } },
                                                        legacy: {
                                                            full_text: 'RT @bob: original text',
                                                            retweeted_status_result: { result: originalResult },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        };
        const result = __test__.parseHomeTimeline(payload, new Set());
        expect(result.tweets).toHaveLength(1);
        expect(result.tweets[0].id).toBe('orig-1');
    });
});
