# YT Shuffle

A true shuffle for YouTube playlists.

## The Problem

YouTube's built-in shuffle is broken for large playlists. When you play a playlist, YouTube only loads the first ~200 videos. If you enable shuffle, it shuffles within those 200 videos only. Any videos beyond that limit are never loaded, never shuffled, and never played. If your playlist has 500 or 1,000+ videos, most of them are effectively invisible to YouTube's shuffle.

## How YT Shuffle Fixes This

YT Shuffle uses the YouTube Data API to fetch **every single video** in the playlist, regardless of size, by paginating through all results. It then applies a proper [Fisher-Yates shuffle](https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle) to the complete list. Every video has an equal chance of being played.

Everything runs in your browser on a static GitHub Pages site. Playlists are read straight from the YouTube Data API and videos are embedded from youtube-nocookie.com. No backend, no tracking, no accounts.

## Features

- Fetches the entire playlist (not just the first 200 videos)
- Fisher-Yates shuffle for true randomness
- Sequential playback with auto-advance
- Reshuffle without interrupting the current video
- Filter/search within the playlist
- Shareable URLs (`?pid=PLAYLIST_ID`)
- Light/dark theme (follows system preference, manual toggle persisted)
- Responsive layout for desktop and mobile

## Usage

1. Go to [rursache.github.io/yt-shuffle](https://rursache.github.io/yt-shuffle/)
2. Paste a YouTube playlist URL or ID
3. Click **Shuffle & Play**

Or link directly: `https://rursache.github.io/yt-shuffle/?pid=YOUR_PLAYLIST_ID`

## Forking

The API key is injected into `js/app.js` when the site is deployed, so it ends up public in the browser. That is the normal setup for a browser key as long as it is restricted. If you fork this repo:

1. Create a YouTube Data API v3 key in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Restrict it to your site under **Application restrictions → Websites** (for example `https://yourname.github.io/*`) and to the YouTube Data API v3 under **API restrictions**
3. Add it as a repository secret named `YOUTUBE_API_KEY`
4. Enable GitHub Pages with **GitHub Actions** as the source, allow `v*` tags under **Settings → Environments → github-pages**, then publish a release or run the **Deploy to GitHub Pages** workflow manually

To try the site locally, replace `__YOUTUBE_API_KEY__` in `js/app.js` with a key that allows your local origin, and don't commit it

## Testing

The test suite uses [Playwright](https://playwright.dev/). Browser tests serve the site locally, answer YouTube Data API requests with mock playlists and play through the real YouTube embed, so they need an internet connection.

```bash
npm install
npx playwright install chromium
npm test
```

## Credits

Inspired by [ytplr](https://ytplr.bitbucket.io/).
