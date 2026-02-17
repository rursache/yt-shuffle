const API_KEY = '__YOUTUBE_API_KEY__';

(function () {
    'use strict';

    // DOM elements
    const playlistInput = document.getElementById('playlist-input');
    const shuffleBtn = document.getElementById('shuffle-btn');
    const loadingEl = document.getElementById('loading');
    const errorEl = document.getElementById('error');
    const contentEl = document.getElementById('content');
    const nowPlayingTitle = document.getElementById('now-playing-title');
    const nowPlayingChannel = document.getElementById('now-playing-channel');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const reshuffleBtn = document.getElementById('reshuffle-btn');
    const playlistCount = document.getElementById('playlist-count');
    const filterInput = document.getElementById('filter-input');
    const playlistList = document.getElementById('playlist-list');
    const themeToggle = document.getElementById('theme-toggle');
    const inputSection = document.getElementById('input-section');
    const changePlaylistBtn = document.getElementById('change-playlist-btn');
    const nowPlayingDate = document.getElementById('now-playing-date');
    const playerColumn = document.getElementById('player-column');
    const playlistColumn = document.getElementById('playlist-column');
    const shuffleAgainBtn = document.getElementById('shuffle-again-btn');

    // State
    let originalVideos = [];
    let shuffledVideos = [];
    let currentIndex = -1;
    let ytPlayer = null;
    let playerReady = false;
    let pendingVideoId = null;

    // --- Theme ---
    function initTheme() {
        const stored = localStorage.getItem('yt-shuffle-theme');
        if (stored) {
            document.documentElement.setAttribute('data-theme', stored);
        }
    }

    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        let next;
        if (current === 'dark') {
            next = 'light';
        } else if (current === 'light') {
            next = 'dark';
        } else {
            // No manual override — check system preference
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            next = prefersDark ? 'light' : 'dark';
        }
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('yt-shuffle-theme', next);
    }

    themeToggle.addEventListener('click', toggleTheme);
    initTheme();

    // --- URL Params ---
    function getUrlParams() {
        const params = new URLSearchParams(window.location.search);
        return {
            pid: params.get('pid'),
        };
    }

    function updateUrl(playlistId) {
        const url = new URL(window.location.href);
        url.searchParams.set('pid', playlistId);
        history.pushState(null, '', url.toString());
    }

    // --- Playlist ID Extraction ---
    function extractPlaylistId(input) {
        input = input.trim();
        // Direct ID (no URL chars)
        if (/^[A-Za-z0-9_-]+$/.test(input) && input.length > 10) {
            return input;
        }
        try {
            const url = new URL(input);
            const list = url.searchParams.get('list');
            if (list) return list;
        } catch (_) {
            // not a URL
        }
        return input;
    }

    // --- YouTube Data API ---
    async function fetchPlaylistItems(playlistId) {
        let allItems = [];
        let pageToken = '';

        do {
            const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${encodeURIComponent(playlistId)}&key=${API_KEY}${pageToken ? '&pageToken=' + pageToken : ''}`;
            const res = await fetch(url);

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                const msg = data?.error?.message || `HTTP ${res.status}`;
                throw new Error(msg);
            }

            const data = await res.json();
            const items = (data.items || [])
                .filter(item => {
                    const title = item.snippet?.title || '';
                    return title !== 'Deleted video' && title !== 'Private video';
                })
                .map(item => ({
                    videoId: item.snippet.resourceId.videoId,
                    title: item.snippet.title,
                    channel: item.snippet.videoOwnerChannelTitle || '',
                    thumbnail: item.snippet.thumbnails?.medium?.url
                        || item.snippet.thumbnails?.default?.url
                        || '',
                    publishedAt: item.contentDetails?.videoPublishedAt || '',
                }));

            allItems = allItems.concat(items);
            pageToken = data.nextPageToken || '';
        } while (pageToken);

        return allItems;
    }

    // --- Fisher-Yates Shuffle ---
    function fisherYatesShuffle(arr) {
        const shuffled = [...arr];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    // --- YouTube IFrame Player API ---
    function loadYouTubeAPI() {
        if (window.YT && window.YT.Player) return Promise.resolve();
        return new Promise((resolve) => {
            const tag = document.createElement('script');
            tag.src = 'https://www.youtube.com/iframe_api';
            document.head.appendChild(tag);
            window.onYouTubeIframeAPIReady = resolve;
        });
    }

    function createPlayer(videoId) {
        return new Promise((resolve) => {
            if (ytPlayer) {
                ytPlayer.destroy();
                ytPlayer = null;
                playerReady = false;
            }

            ytPlayer = new YT.Player('player', {
                videoId: videoId,
                playerVars: {
                    autoplay: 1,
                    rel: 0,
                    modestbranding: 1,
                },
                events: {
                    onReady: function () {
                        playerReady = true;
                        // Try normal autoplay first; if browser blocks it,
                        // fall back to muted autoplay
                        ytPlayer.playVideo();
                        setTimeout(function () {
                            if (ytPlayer.getPlayerState && ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING) {
                                ytPlayer.mute();
                                ytPlayer.playVideo();
                            }
                        }, 500);
                        resolve();
                        if (pendingVideoId) {
                            const vid = pendingVideoId;
                            pendingVideoId = null;
                            ytPlayer.loadVideoById(vid);
                        }
                    },
                    onStateChange: function (event) {
                        if (event.data === YT.PlayerState.ENDED) {
                            playNext();
                        }
                    },
                    onError: function () {
                        // Skip unavailable videos
                        playNext();
                    },
                },
            });
        });
    }

    // --- Playback ---
    function playVideo(index) {
        if (index < 0 || index >= shuffledVideos.length) return;
        currentIndex = index;
        const video = shuffledVideos[index];

        nowPlayingTitle.textContent = video.title;
        nowPlayingChannel.textContent = video.channel;
        nowPlayingDate.textContent = formatDate(video.publishedAt);

        if (playerReady && ytPlayer) {
            ytPlayer.loadVideoById(video.videoId);
        } else {
            pendingVideoId = video.videoId;
        }

        updateActiveItem();
    }

    function playNext() {
        if (shuffledVideos.length === 0) return;
        const next = (currentIndex + 1) % shuffledVideos.length;
        playVideo(next);
    }

    function playPrev() {
        if (shuffledVideos.length === 0) return;
        const prev = (currentIndex - 1 + shuffledVideos.length) % shuffledVideos.length;
        playVideo(prev);
    }

    function handleReshuffle() {
        if (originalVideos.length === 0) return;
        const currentVideo = shuffledVideos[currentIndex];
        shuffledVideos = fisherYatesShuffle(originalVideos);

        // Keep current video at its new position
        const newIndex = shuffledVideos.findIndex(v => v.videoId === currentVideo.videoId);
        if (newIndex !== -1) {
            // Move current video to index 0, shift the rest
            [shuffledVideos[0], shuffledVideos[newIndex]] = [shuffledVideos[newIndex], shuffledVideos[0]];
            currentIndex = 0;
        }

        renderPlaylist();
        updateActiveItem();
    }

    // --- Playlist Rendering ---
    function renderPlaylist() {
        const filter = filterInput.value.toLowerCase();
        playlistList.innerHTML = '';

        shuffledVideos.forEach((video, index) => {
            if (filter && !video.title.toLowerCase().includes(filter) && !video.channel.toLowerCase().includes(filter)) {
                return;
            }

            const li = document.createElement('li');
            li.className = 'playlist-item' + (index === currentIndex ? ' active' : '');
            li.dataset.index = index;

            li.innerHTML = `
                <span class="playlist-item-index">${index + 1}</span>
                <img class="playlist-item-thumb" src="${escapeAttr(video.thumbnail)}" alt="" loading="lazy">
                <div class="playlist-item-info">
                    <div class="playlist-item-title">${escapeHtml(video.title)}</div>
                </div>
            `;

            li.addEventListener('click', () => playVideo(index));
            playlistList.appendChild(li);
        });
    }

    function updateActiveItem() {
        const items = playlistList.querySelectorAll('.playlist-item');
        items.forEach(item => {
            const idx = parseInt(item.dataset.index, 10);
            item.classList.toggle('active', idx === currentIndex);
        });

        // Scroll so the active item is the second visible element
        const activeEl = playlistList.querySelector('.playlist-item.active');
        if (activeEl) {
            const prevSibling = activeEl.previousElementSibling;
            const scrollTarget = prevSibling || activeEl;
            scrollTarget.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
    }

    // --- Sync playlist height to player column ---
    function syncPlaylistHeight() {
        if (contentEl.classList.contains('hidden')) return;
        playlistColumn.style.maxHeight = playerColumn.offsetHeight + 'px';
    }

    window.addEventListener('resize', () => {
        playlistColumn.style.maxHeight = '';
        requestAnimationFrame(syncPlaylistHeight);
    });

    // --- Helpers ---
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function escapeAttr(str) {
        return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function formatDate(isoStr) {
        if (!isoStr) return '';
        const d = new Date(isoStr);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
    }

    function showError(msg) {
        errorEl.textContent = msg;
        errorEl.classList.remove('hidden');
    }

    function hideError() {
        errorEl.classList.add('hidden');
    }

    function setLoading(on) {
        loadingEl.classList.toggle('hidden', !on);
        shuffleBtn.disabled = on;
    }

    // --- Main Load Flow ---
    async function loadPlaylist(rawInput) {
        hideError();
        const playlistId = extractPlaylistId(rawInput);
        if (!playlistId) {
            showError('Please enter a valid YouTube playlist URL or ID.');
            return;
        }

        setLoading(true);
        contentEl.classList.add('hidden');

        try {
            originalVideos = await fetchPlaylistItems(playlistId);
            if (originalVideos.length === 0) {
                throw new Error('No playable videos found in this playlist.');
            }

            shuffledVideos = fisherYatesShuffle(originalVideos);
            currentIndex = 0;

            playlistCount.textContent = `${shuffledVideos.length} videos`;
            filterInput.value = '';
            renderPlaylist();

            updateUrl(playlistId);

            setLoading(false);
            contentEl.classList.remove('hidden');
            inputSection.classList.add('hidden');
            changePlaylistBtn.classList.remove('hidden');

            await loadYouTubeAPI();

            const firstVideo = shuffledVideos[0];
            nowPlayingTitle.textContent = firstVideo.title;
            nowPlayingChannel.textContent = firstVideo.channel;
            nowPlayingDate.textContent = formatDate(firstVideo.publishedAt);

            await createPlayer(firstVideo.videoId);
            syncPlaylistHeight();
        } catch (err) {
            setLoading(false);
            showError(err.message || 'Failed to load playlist.');
        }
    }

    // --- Event Listeners ---
    shuffleBtn.addEventListener('click', () => {
        const val = playlistInput.value.trim();
        if (val) loadPlaylist(val);
    });

    playlistInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const val = playlistInput.value.trim();
            if (val) loadPlaylist(val);
        }
    });

    prevBtn.addEventListener('click', playPrev);
    nextBtn.addEventListener('click', playNext);
    reshuffleBtn.addEventListener('click', handleReshuffle);
    shuffleAgainBtn.addEventListener('click', handleReshuffle);

    filterInput.addEventListener('input', renderPlaylist);

    changePlaylistBtn.addEventListener('click', () => {
        inputSection.classList.remove('hidden');
        changePlaylistBtn.classList.add('hidden');
        playlistInput.focus();
    });

    // --- Init from URL ---
    const params = getUrlParams();
    if (params.pid) {
        playlistInput.value = params.pid;
        inputSection.classList.add('hidden');
        changePlaylistBtn.classList.remove('hidden');
        loadPlaylist(params.pid);
    }
})();
