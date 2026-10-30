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
    let currentPlaylistId = null;
    let isLoading = false;
    let failedVideoIds = new Set();
    let direction = 1;
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

    function updateUrl(playlistId, replace) {
        if (getUrlParams().pid === playlistId) return;
        const url = new URL(window.location.href);
        url.searchParams.set('pid', playlistId);
        if (replace) {
            history.replaceState(null, '', url.toString());
        } else {
            history.pushState(null, '', url.toString());
        }
    }

    const PLAYLIST_ID_PATTERN = /^[A-Za-z0-9_-]{10,64}$/;

    function extractPlaylistId(input) {
        input = input.trim();
        if (PLAYLIST_ID_PATTERN.test(input)) {
            return input;
        }
        try {
            const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
            const list = url.searchParams.get('list');
            if (list && PLAYLIST_ID_PATTERN.test(list)) return list;
        } catch (_) {}
        return null;
    }

    const API_ERROR_MESSAGES = {
        playlistNotFound: 'Playlist not found. Make sure it exists and is public or unlisted.',
        playlistItemsNotAccessible: 'This playlist is private. Only public or unlisted playlists can be shuffled.',
        watchLaterNotAccessible: 'Watch Later is private and cannot be shuffled.',
        quotaExceeded: 'The daily YouTube API quota has been used up. Please try again tomorrow.',
        dailyLimitExceeded: 'The daily YouTube API quota has been used up. Please try again tomorrow.',
    };

    function apiErrorMessage(data, status) {
        const reason = data?.error?.errors?.[0]?.reason;
        if (reason && API_ERROR_MESSAGES[reason]) return API_ERROR_MESSAGES[reason];
        const message = data?.error?.message;
        if (message) {
            return new DOMParser().parseFromString(message, 'text/html').body.textContent;
        }
        return `Failed to load playlist (HTTP ${status}).`;
    }

    function isPlayableItem(item) {
        const snippet = item.snippet;
        if (!snippet?.resourceId?.videoId) return false;
        if (snippet.videoOwnerChannelId) return true;
        return snippet.title !== 'Deleted video' && snippet.title !== 'Private video';
    }

    async function fetchPlaylistItems(playlistId, signal) {
        let allItems = [];
        let pageToken = '';

        do {
            const url = `${WORKER_URL}?playlistId=${encodeURIComponent(playlistId)}${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`;
            const res = await fetch(url, { signal });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(apiErrorMessage(data, res.status));
            }

            const data = await res.json();
            const items = (data.items || [])
                .filter(isPlayableItem)
                .map(item => ({
                    videoId: item.snippet.resourceId.videoId,
                    title: item.snippet.title || '',
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
            const fail = () => {
                clearTimeout(timeout);
                tag.remove();
                youTubeAPIPromise = null;
                reject(new Error('Could not load the YouTube player. Check your connection or content blocker.'));
            };
            const timeout = setTimeout(fail, 15000);
            tag.src = 'https://www.youtube.com/iframe_api';
            tag.onerror = fail;
            window.onYouTubeIframeAPIReady = () => {
                clearTimeout(timeout);
                resolve();
            };
            document.head.appendChild(tag);
        });
        return youTubeAPIPromise;
    }

    function setupAutoUnmute() {
        const events = ['mousedown', 'pointerdown', 'pointerup', 'keydown', 'touchend', 'click'];
        function handleInteraction() {
            if (navigator.userActivation && !navigator.userActivation.isActive) return;
            if (ytPlayer && ytPlayer.isMuted()) {
                ytPlayer.unMute();
            }
            events.forEach((e) => document.removeEventListener(e, handleInteraction, true));
        }
        events.forEach((e) => document.addEventListener(e, handleInteraction, true));
    }

    function createPlayer(videoId, hasUserGesture) {
        return new Promise((resolve) => {
            if (ytPlayer) {
                ytPlayer.destroy();
                ytPlayer = null;
                playerReady = false;
            }

            const player = new YT.Player('player', {
                host: 'https://www.youtube-nocookie.com',
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
                            if (isLoading) {
                                player.cueVideoById(vid);
                            } else {
                                player.loadVideoById(vid);
                            }
                        } else if (!isLoading) {
                            player.playVideo();
                        }
                        resolve();
                    },
                    onStateChange: function (event) {
                        if (player !== ytPlayer) return;
                        if (event.data === YT.PlayerState.PLAYING && isLoading) {
                            player.pauseVideo();
                        }
                        if (event.data === YT.PlayerState.ENDED) {
                            playNext();
                        }
                    },
                    onError: function () {
                        if (player !== ytPlayer) return;
                        const video = shuffledVideos[currentIndex];
                        if (video) failedVideoIds.add(video.videoId);
                        step(direction);
                    },
                },
            });
            ytPlayer = player;
        });
    }

    function playVideo(index, dir = 1) {
        if (index < 0 || index >= shuffledVideos.length) return;
        currentIndex = index;
        direction = dir;
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

    function step(dir) {
        const total = shuffledVideos.length;
        if (total === 0) return;
        let index = currentIndex;
        for (let i = 0; i < total; i++) {
            index = (index + dir + total) % total;
            if (!failedVideoIds.has(shuffledVideos[index].videoId)) {
                playVideo(index, dir);
                return;
            }
        }
        if (ytPlayer && playerReady) ytPlayer.stopVideo();
        showError('None of the videos in this playlist can be played in an embedded player.');
    }

    function playNext() {
        step(1);
    }

    function playPrev() {
        step(-1);
    }

    function handleReshuffle() {
        if (originalVideos.length === 0) return;
        const currentVideo = shuffledVideos[currentIndex];
        shuffledVideos = fisherYatesShuffle(originalVideos);
        failedVideoIds = new Set();
        hideError();

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
        const fragment = document.createDocumentFragment();

        shuffledVideos.forEach((video, index) => {
            if (filter && !video.title.toLowerCase().includes(filter) && !video.channel.toLowerCase().includes(filter)) {
                return;
            }

            const li = document.createElement('li');
            li.className = 'playlist-item' + (index === currentIndex ? ' active' : '');
            li.dataset.index = index;
            li.tabIndex = 0;
            if (index === currentIndex) li.setAttribute('aria-current', 'true');

            li.innerHTML = `
                <span class="playlist-item-index">${index + 1}</span>
                <img class="playlist-item-thumb" src="${escapeAttr(video.thumbnail)}" alt="" loading="lazy">
                <div class="playlist-item-info">
                    <div class="playlist-item-title">${escapeHtml(video.title)}</div>
                </div>
            `;

            fragment.appendChild(li);
        });

        playlistList.replaceChildren(fragment);
    }

    function updateActiveItem() {
        const items = playlistList.querySelectorAll('.playlist-item');
        items.forEach(item => {
            const idx = parseInt(item.dataset.index, 10);
            item.classList.toggle('active', idx === currentIndex);
            if (idx === currentIndex) {
                item.setAttribute('aria-current', 'true');
            } else {
                item.removeAttribute('aria-current');
            }
        });

        const activeEl = playlistList.querySelector('.playlist-item.active');
        if (activeEl) {
            const prevSibling = activeEl.previousElementSibling;
            const scrollTarget = prevSibling || activeEl;
            const offset = scrollTarget.getBoundingClientRect().top - playlistList.getBoundingClientRect().top;
            playlistList.scrollTo({ top: playlistList.scrollTop + offset, behavior: 'smooth' });
        }
    }

    function syncPlaylistHeight() {
        if (contentEl.classList.contains('hidden')) return;
        playlistColumn.style.maxHeight = playerColumn.offsetHeight + 'px';
    }

    new ResizeObserver(syncPlaylistHeight).observe(playerColumn);

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
        isLoading = on;
        loadingEl.classList.toggle('hidden', !on);
        shuffleBtn.disabled = on;
    }

    async function loadPlaylist(rawInput, hasUserGesture, fromHistory = false) {
        hideError();
        const playlistId = extractPlaylistId(rawInput);
        if (!playlistId) {
            if (shuffledVideos.length === 0) {
                inputSection.classList.remove('hidden');
                changePlaylistBtn.classList.add('hidden');
            }
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
            hideError();
            if (videos.length === 0) {
                throw new Error('No playable videos found in this playlist.');
            }

            currentPlaylistId = playlistId;
            originalVideos = videos;
            shuffledVideos = fisherYatesShuffle(originalVideos);
            currentIndex = 0;
            pendingVideoId = null;
            failedVideoIds = new Set();
            direction = 1;

            playlistCount.textContent = `${shuffledVideos.length} ${shuffledVideos.length === 1 ? 'video' : 'videos'}`;
            filterInput.value = '';
            renderPlaylist();

            updateUrl(playlistId, fromHistory);

            setLoading(false);
            contentEl.classList.remove('hidden');
            inputSection.classList.add('hidden');
            changePlaylistBtn.classList.remove('hidden');

            const firstVideo = shuffledVideos[0];
            nowPlayingTitle.textContent = firstVideo.title;
            nowPlayingChannel.textContent = firstVideo.channel;
            nowPlayingDate.textContent = formatDate(firstVideo.publishedAt);

            await createPlayer(firstVideo.videoId, hasUserGesture);
        } catch (err) {
            if (thisLoad !== loadId) return;
            loadController.abort();
            setLoading(false);
            if (shuffledVideos.length > 0) {
                contentEl.classList.remove('hidden');
                if (fromHistory) updateUrl(currentPlaylistId, true);
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

    playlistList.addEventListener('click', (e) => {
        const item = e.target.closest('.playlist-item');
        if (item) playVideo(parseInt(item.dataset.index, 10));
    });

    playlistList.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const item = e.target.closest('.playlist-item');
        if (!item) return;
        e.preventDefault();
        playVideo(parseInt(item.dataset.index, 10));
    });

    changePlaylistBtn.addEventListener('click', () => {
        inputSection.classList.remove('hidden');
        changePlaylistBtn.classList.add('hidden');
        playlistInput.focus();
    });

    function resetToInput() {
        loadId++;
        if (loadController) loadController.abort();
        if (ytPlayer) {
            ytPlayer.destroy();
            ytPlayer = null;
            playerReady = false;
        }
        currentPlaylistId = null;
        originalVideos = [];
        shuffledVideos = [];
        currentIndex = -1;
        pendingVideoId = null;
        playlistInput.value = '';
        setLoading(false);
        hideError();
        contentEl.classList.add('hidden');
        inputSection.classList.remove('hidden');
        changePlaylistBtn.classList.add('hidden');
    }

    function loadFromUrl(hasUserGesture) {
        const params = getUrlParams();
        if (!params.pid) {
            resetToInput();
            return;
        }
        playlistInput.value = params.pid;
        inputSection.classList.add('hidden');
        changePlaylistBtn.classList.remove('hidden');
        loadPlaylist(params.pid, hasUserGesture, true);
    }

    window.addEventListener('popstate', () => {
        loadFromUrl(navigator.userActivation ? navigator.userActivation.hasBeenActive : false);
    });

    if (getUrlParams().pid) {
        loadFromUrl(false);
    }
})();
