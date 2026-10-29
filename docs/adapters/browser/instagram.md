# Instagram

**Mode**: 🔐 Browser · **Domain**: `instagram.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli instagram profile` | Get user profile info |
| `opencli instagram search` | Search users |
| `opencli instagram user` | Get recent posts from a user |
| `opencli instagram feed` | Get posts from your logged-in homepage |
| `opencli instagram explore` | Discover trending posts |
| `opencli instagram followers` | List user's followers |
| `opencli instagram following` | List user's following |
| `opencli instagram saved` | Get your saved posts (or one collection) |
| `opencli instagram collection-create` | Create a new saved-posts collection |
| `opencli instagram collection-delete` | Delete a saved-posts collection by name or id |

## Usage Examples

```bash
# View a user's profile
opencli instagram profile nasa

# Search users
opencli instagram search nasa --limit 5

# View a user's recent posts
opencli instagram user nasa --limit 10

# Read your home feed (no username needed)
opencli instagram feed --limit 20
opencli instagram feed --limit 10 -f json

# Discover trending posts
opencli instagram explore --limit 20

# List followers/following
opencli instagram followers nasa --limit 20
opencli instagram following nasa --limit 20

# Get your saved posts (default "All posts" feed)
opencli instagram saved --limit 10

# Get posts from a specific collection (case-insensitive name match)
opencli instagram saved --collection inspiration --limit 10

# Create a new saved-posts collection
opencli instagram collection-create "design refs"

# Delete a collection by name (or by numeric id, e.g. 17853899493659567)
opencli instagram collection-delete "design refs"

# JSON output
opencli instagram profile nasa -f json
```

### Profile photos

`instagram profile` and `instagram search` include an `avatar_url` column with the account's profile photo (`profile` prefers the HD version). It is empty when Instagram sends none. These are signed `cdninstagram.com` / `fbcdn.net` URLs: they expire, and Instagram's CDN often refuses to load them on other sites. Download the image when you need it; don't store the URL for later hotlinking.

### Notes on the home feed

- `feed` reads the logged-in homepage in display order, including recommendations. Posts with explicit ad metadata or a Sponsored/promotion header label are filtered before counting toward `--limit`. Ordinary brand posts and advertising words in captions are retained. It is not a following-only or chronological feed.
- `--limit` defaults to 20 and accepts 1–100. The command scrolls a bounded number of times, collects posts across viewports, and deduplicates by post URL. It may return fewer posts if loading stops or the feed is exhausted.
- Rows include `index`, `user`, `caption`, `likes`, `comments`, `type`, `date`, `url`, `images`, and `media`. `media` contains ordered `{type: 'image', url}` or `{type: 'video', url, poster}` entries, including playable video URLs. `images` remains an ordered array of photo/cover URLs. Carousels use the full media metadata list in original publication order and select the largest available rendition per slide. If complete metadata cannot be read, the command reports an error instead of silently returning a partial carousel.
- Captions contain the visible preview; counts retain the displayed text (including rounded/localized values). Hidden counts and unavailable fields are empty, rather than zero. `date` uses the page's datetime attribute where available.
- The command reads rendered posts without calling the account-info endpoint. Login challenges and changes to Instagram's page markup can still prevent extraction.

### Notes on collections

- `instagram saved` without `--collection` returns the unsegmented "All posts" bucket (same as the original behaviour).
- With `--collection <name>` it resolves the name to an id via `/api/v1/collections/list/`, then fetches `/api/v1/feed/collection/{id}/posts/`. Match is case-insensitive after trimming. An unknown name throws an error that lists the available names.
- `instagram collection-create <name>` calls `POST /api/v1/collections/create/` with a multipart `name` field. Instagram silently accepts duplicate names — the API just returns a new `collection_id` each time, so dedupe client-side if you care.
- `instagram collection-delete <name-or-id>` calls `POST /api/v1/collections/{id}/delete/`. Pass either a case-insensitive collection name or a numeric `collection_id`. If the name resolves to multiple collections (e.g. duplicates from `collection-create`), the adapter throws and lists the candidate ids so you can disambiguate by passing the id explicitly. Unknown names list the available collections in the error message.
- Saving an existing post directly into a named collection in one shot is not exposed by the web app's documented endpoints (`/api/v1/web/save/{pk}/save/` only writes to "All posts"). Use `instagram save` first, then move the post in the UI, or extend with the `/api/v1/collections/{id}/edit/` mutation.

## Prerequisites

- Chrome running and **logged into** instagram.com
- [Browser Bridge extension](/guide/browser-bridge) installed
