const WORKER_URL = 'https://yt-shuffle.radu-ursache.workers.dev';

(function () {
    'use strict';

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

    let originalVideos = [];
    let shuffledVideos = [];
    let currentIndex = -1;
    let ytPlayer = null;
    let playerReady = false;
    let pendingVideoId = null;
    let loadId = 0;
    let loadController = null;

    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        let next;
        if (current === 'dark') {
            next = 'light';
        } else if (current === 'light') {
            next = 'dark';
        } else {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            next = prefersDark ? 'light' : 'dark';
        }
        document.documentElement.setAttribute('data-theme', next);
        try {
            localStorage.setItem('yt-shuffle-theme', next);
        } catch (_) {}
    }

    themeToggle.addEventListener('click', toggleTheme);

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

    function extractPlaylistId(input) {
        input = input.trim();
        if (/^[A-Za-z0-9_-]+$/.test(input) && input.length > 10) {
            return input;
        }
        try {
            const url = new URL(input);
            const list = url.searchParams.get('list');
            if (list) return list;
        } catch (_) {}
        return input;
    }

    async function fetchPlaylistItems(playlistId, signal) {
        let allItems = [];
        let pageToken = '';

        do {
            const url = `${WORKER_URL}?playlistId=${encodeURIComponent(playlistId)}${pageToken ? '&pageToken=' + pageToken : ''}`;
            const res = await fetch(url, { signal });

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

    function fisherYatesShuffle(arr) {
        const shuffled = [...arr];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    let youTubeAPIPromise = null;

    function loadYouTubeAPI() {
        if (window.YT && window.YT.Player) return Promise.resolve();
        if (youTubeAPIPromise) return youTubeAPIPromise;
        youTubeAPIPromise = new Promise((resolve, reject) => {
            const tag = document.createElement('script');
            tag.src = 'https://www.youtube.com/iframe_api';
            tag.onerror = () => {
                tag.remove();
                youTubeAPIPromise = null;
                reject(new Error('Could not load the YouTube player. Check your connection or content blocker.'));
            };
            window.onYouTubeIframeAPIReady = resolve;
            document.head.appendChild(tag);
        });
        return youTubeAPIPromise;
    }

    function setupAutoUnmute() {
        var events = ['mousedown', 'pointerdown', 'keydown', 'touchstart'];
        function handleInteraction() {
            if (ytPlayer && ytPlayer.isMuted()) {
                ytPlayer.unMute();
            }
            events.forEach(function (e) { document.removeEventListener(e, handleInteraction); });
        }
        events.forEach(function (e) { document.addEventListener(e, handleInteraction); });
    }

    function createPlayer(videoId, hasUserGesture) {
        return new Promise((resolve) => {
            if (ytPlayer) {
                ytPlayer.destroy();
                ytPlayer = null;
                playerReady = false;
            }

            const player = new YT.Player('player', {
                videoId: videoId,
                playerVars: {
                    autoplay: 1,
                    rel: 0,
                    modestbranding: 1,
                },
                events: {
                    onReady: function () {
                        if (player !== ytPlayer) return;
                        playerReady = true;
                        if (!hasUserGesture) {
                            player.mute();
                            setupAutoUnmute();
                        }
                        if (pendingVideoId) {
                            const vid = pendingVideoId;
                            pendingVideoId = null;
                            player.loadVideoById(vid);
                        } else {
                            player.playVideo();
                        }
                        resolve();
                    },
                    onStateChange: function (event) {
                        if (player !== ytPlayer) return;
                        if (event.data === YT.PlayerState.ENDED) {
                            playNext();
                        }
                    },
                    onError: function () {
                        if (player !== ytPlayer) return;
                        playNext();
                    },
                },
            });
            ytPlayer = player;
        });
    }

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

        const newIndex = shuffledVideos.findIndex(v => v.videoId === currentVideo.videoId);
        if (newIndex !== -1) {
            [shuffledVideos[0], shuffledVideos[newIndex]] = [shuffledVideos[newIndex], shuffledVideos[0]];
            currentIndex = 0;
        }

        renderPlaylist();
        updateActiveItem();
    }

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

        const activeEl = playlistList.querySelector('.playlist-item.active');
        if (activeEl) {
            const prevSibling = activeEl.previousElementSibling;
            const scrollTarget = prevSibling || activeEl;
            scrollTarget.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
    }

    function syncPlaylistHeight() {
        if (contentEl.classList.contains('hidden')) return;
        playlistColumn.style.maxHeight = playerColumn.offsetHeight + 'px';
    }

    window.addEventListener('resize', () => {
        playlistColumn.style.maxHeight = '';
        requestAnimationFrame(syncPlaylistHeight);
    });

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

    async function loadPlaylist(rawInput, hasUserGesture) {
        hideError();
        const playlistId = extractPlaylistId(rawInput);
        if (!playlistId) {
            showError('Please enter a valid YouTube playlist URL or ID.');
            return;
        }

        const thisLoad = ++loadId;
        if (loadController) loadController.abort();
        loadController = new AbortController();

        setLoading(true);
        contentEl.classList.add('hidden');
        if (playerReady && ytPlayer) ytPlayer.pauseVideo();

        try {
            const [videos] = await Promise.all([
                fetchPlaylistItems(playlistId, loadController.signal),
                loadYouTubeAPI(),
            ]);
            if (thisLoad !== loadId) return;
            if (videos.length === 0) {
                throw new Error('No playable videos found in this playlist.');
            }

            originalVideos = videos;
            shuffledVideos = fisherYatesShuffle(originalVideos);
            currentIndex = 0;
            pendingVideoId = null;

            playlistCount.textContent = `${shuffledVideos.length} videos`;
            filterInput.value = '';
            renderPlaylist();

            updateUrl(playlistId);

            setLoading(false);
            contentEl.classList.remove('hidden');
            inputSection.classList.add('hidden');
            changePlaylistBtn.classList.remove('hidden');

            const firstVideo = shuffledVideos[0];
            nowPlayingTitle.textContent = firstVideo.title;
            nowPlayingChannel.textContent = firstVideo.channel;
            nowPlayingDate.textContent = formatDate(firstVideo.publishedAt);

            await createPlayer(firstVideo.videoId, hasUserGesture);
            if (thisLoad !== loadId) return;
            syncPlaylistHeight();
        } catch (err) {
            if (thisLoad !== loadId) return;
            setLoading(false);
            if (shuffledVideos.length > 0) {
                contentEl.classList.remove('hidden');
            } else {
                inputSection.classList.remove('hidden');
                changePlaylistBtn.classList.add('hidden');
            }
            showError(err.message || 'Failed to load playlist.');
        }
    }

    shuffleBtn.addEventListener('click', () => {
        const val = playlistInput.value.trim();
        if (val) loadPlaylist(val, true);
    });

    playlistInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const val = playlistInput.value.trim();
            if (val) loadPlaylist(val, true);
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

    const params = getUrlParams();
    if (params.pid) {
        playlistInput.value = params.pid;
        inputSection.classList.add('hidden');
        changePlaylistBtn.classList.remove('hidden');
        loadPlaylist(params.pid, false);
    }
})();
