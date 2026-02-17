export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': 'https://rursache.github.io',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Only allow GET
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Only allow requests from your site
    const origin = request.headers.get('Origin');
    if (origin && origin !== 'https://rursache.github.io') {
      return new Response('Forbidden', { status: 403 });
    }

    const url = new URL(request.url);
    const playlistId = url.searchParams.get('playlistId');
    const pageToken = url.searchParams.get('pageToken');

    if (!playlistId) {
      return new Response(JSON.stringify({ error: 'Missing playlistId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Build YouTube API URL
    let ytUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${encodeURIComponent(playlistId)}&key=${env.YOUTUBE_API_KEY}`;
    if (pageToken) {
      ytUrl += `&pageToken=${encodeURIComponent(pageToken)}`;
    }

    const ytRes = await fetch(ytUrl);
    const data = await ytRes.text();

    return new Response(data, {
      status: ytRes.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'https://rursache.github.io',
      },
    });
  },
};
