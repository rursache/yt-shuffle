import { test, expect } from '@playwright/test';
import worker from '../worker/worker.js';

const env = { YOUTUBE_API_KEY: 'test-key' };
const realFetch = globalThis.fetch;
let upstream;

test.beforeEach(() => {
    upstream = { calls: [], fail: false };
    globalThis.fetch = async (url) => {
        upstream.calls.push(String(url));
        if (upstream.fail) throw new Error('network down');
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
    };
});

test.afterEach(() => {
    globalThis.fetch = realFetch;
});

async function call(path, init) {
    const res = await worker.fetch(new Request(`https://worker.test${path}`, init), env);
    return { status: res.status, cors: res.headers.get('Access-Control-Allow-Origin'), body: await res.json().catch(() => null) };
}

test('proxies a valid playlist request with the key and page token', async () => {
    const res = await call('/?playlistId=PLabcdefghij&pageToken=EAAaBlBUOkNESQ', { headers: { Origin: 'https://rursache.github.io' } });
    expect(res.status).toBe(200);
    expect(res.cors).toBe('https://rursache.github.io');
    const upstreamUrl = new URL(upstream.calls[0]);
    expect(upstreamUrl.origin + upstreamUrl.pathname).toBe('https://www.googleapis.com/youtube/v3/playlistItems');
    expect(upstreamUrl.searchParams.get('playlistId')).toBe('PLabcdefghij');
    expect(upstreamUrl.searchParams.get('pageToken')).toBe('EAAaBlBUOkNESQ');
    expect(upstreamUrl.searchParams.get('key')).toBe('test-key');
});

for (const [name, path, message] of [
    ['missing playlist ID', '/', 'Invalid playlist ID'],
    ['short playlist ID', '/?playlistId=short', 'Invalid playlist ID'],
    ['playlist ID with symbols', '/?playlistId=PLabcdef%26key%3Dx', 'Invalid playlist ID'],
    ['page token with symbols', '/?playlistId=PLabcdefghij&pageToken=a%26b', 'Invalid page token'],
]) {
    test(`rejects a ${name} without calling YouTube`, async () => {
        const res = await call(path);
        expect(res.status).toBe(400);
        expect(res.cors).toBe('https://rursache.github.io');
        expect(res.body.error.message).toBe(message);
        expect(upstream.calls).toHaveLength(0);
    });
}

test('rejects foreign origins with a readable error', async () => {
    const res = await call('/?playlistId=PLabcdefghij', { headers: { Origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    expect(res.cors).toBe('https://rursache.github.io');
    expect(upstream.calls).toHaveLength(0);
});

test('rejects methods other than GET', async () => {
    const res = await call('/?playlistId=PLabcdefghij', { method: 'POST' });
    expect(res.status).toBe(405);
    expect(res.cors).toBe('https://rursache.github.io');
});

test('returns 502 when YouTube cannot be reached', async () => {
    upstream.fail = true;
    const res = await call('/?playlistId=PLabcdefghij');
    expect(res.status).toBe(502);
    expect(res.cors).toBe('https://rursache.github.io');
    expect(res.body.error.message).toBe('Could not reach YouTube');
});
