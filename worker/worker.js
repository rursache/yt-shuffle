const ALLOWED_ORIGIN = 'https://rursache.github.io';
const PLAYLIST_ID_PATTERN = /^[A-Za-z0-9_-]{10,64}$/;
const PAGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,1024}$/;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
};

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: { code: status, message } }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          ...CORS_HEADERS,
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (request.method !== 'GET') {
      return jsonError(405, 'Method not allowed');
    }

    const origin = request.headers.get('Origin');
    if (origin && origin !== ALLOWED_ORIGIN) {
      return jsonError(403, 'Forbidden');
    }

    const url = new URL(request.url);
    const playlistId = url.searchParams.get('playlistId');
    const pageToken = url.searchParams.get('pageToken');

    if (!playlistId || !PLAYLIST_ID_PATTERN.test(playlistId)) {
      return jsonError(400, 'Invalid playlist ID');
    }

    if (pageToken && !PAGE_TOKEN_PATTERN.test(pageToken)) {
      return jsonError(400, 'Invalid page token');
    }

    let ytUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${encodeURIComponent(playlistId)}&key=${env.YOUTUBE_API_KEY}`;
    if (pageToken) {
      ytUrl += `&pageToken=${encodeURIComponent(pageToken)}`;
    }

    let ytRes;
    try {
      ytRes = await fetch(ytUrl);
    } catch (_) {
      return jsonError(502, 'Could not reach YouTube');
    }

    const data = await ytRes.text();

    return new Response(data, {
      status: ytRes.status,
      headers: {
        'Content-Type': 'application/json',
        ...CORS_HEADERS,
      },
    });
  },
};
