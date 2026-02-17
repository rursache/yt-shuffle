# YT Shuffle

A true shuffle for YouTube playlists.

## The Problem

YouTube's built-in shuffle is broken for large playlists. When you play a playlist, YouTube only loads the first ~200 videos. If you enable shuffle, it shuffles within those 200 videos only. Any videos beyond that limit are never loaded, never shuffled, and never played. If your playlist has 500 or 1,000+ videos, most of them are effectively invisible to YouTube's shuffle.

## How YT Shuffle Fixes This

YT Shuffle uses the YouTube Data API to fetch **every single video** in the playlist, regardless of size, by paginating through all results. It then applies a proper [Fisher-Yates shuffle](https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle) to the complete list. Every video has an equal chance of being played.

Everything runs client-side in your browser. No backend, no tracking, no accounts.

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

YouTube API requests are proxied through a Cloudflare Worker so the API key is never exposed in client-side code. If you fork this repo, you'll need to set up your own worker:

1. Create a YouTube Data API v3 key in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a [Cloudflare Worker](https://workers.cloudflare.com/) and deploy the proxy code from `worker/worker.js`
3. Add your YouTube API key as a secret named `YOUTUBE_API_KEY` in the worker settings
4. Update `WORKER_URL` in `js/app.js` to point to your worker URL

## Credits

Inspired by [ytplr](https://ytplr.bitbucket.io/).
