(function () {
    const config = window.GAMEVID_CONFIG || {};
    const sections = Array.isArray(config.sections) ? config.sections : [];
    const globalChannels = Array.isArray(config.channels) ? config.channels : [];
    const defaultVideoLimit = Number(config.defaultVideoLimit || 6);
    const apiKey = typeof config.youtubeApiKey === 'string' ? config.youtubeApiKey.trim() : '';

    const playerDiv = document.getElementById('gamePlayer');
    const iframe = document.getElementById('youtubeFrame');
    const playerTitle = document.getElementById('playerTitle');
    const heroTitle = document.getElementById('heroTitle');
    const heroDescription = document.getElementById('heroDescription');
    const heroImage = document.getElementById('heroImage');
    const heroButton = document.getElementById('heroButton');
    const heroLink = document.getElementById('heroLink');
    const feedStatusText = document.getElementById('feedStatusText');
    const channelFilters = document.getElementById('channelFilters');
    const refreshFeedButton = document.getElementById('refreshFeedButton');
    const channelSpotlights = document.getElementById('channelSpotlights');
    const themePicker = document.getElementById('themePicker');
    const recentRow = document.getElementById('row-recent');

    const API_BASE = 'https://www.googleapis.com/youtube/v3';
    const CACHE_KEY = 'gamevid-youtube-cache-v1';
    const CACHE_TTL_MS = 1000 * 60 * 20;
    const RECENT_KEY = 'gamevid-recent-videos-v1';
    const THEME_KEY = 'gamevid-theme-v1';
    const MAX_RECENT = 12;
    const THEMES = [
        { id: 'rgb-default', label: 'Neon RGB' },
        { id: 'sunset-drive', label: 'Sunset Drive' },
        { id: 'ice-core', label: 'Ice Core' }
    ];
    let activeChannel = 'all';
    const sectionState = new Map();
    let recentVideos = [];

    function setStatus(message, mode) {
        feedStatusText.textContent = message;
        const card = document.querySelector('.feed-status-card');
        if (!card) {
            return;
        }

        card.dataset.mode = mode || 'default';
    }

    function applyTheme(themeId) {
        document.body.dataset.theme = themeId;
        try {
            window.localStorage.setItem(THEME_KEY, themeId);
        } catch (error) {
            console.warn('Tema kaydedilemedi:', error);
        }
    }

    function hydrateTheme() {
        let storedTheme = THEMES[0].id;
        try {
            storedTheme = window.localStorage.getItem(THEME_KEY) || THEMES[0].id;
        } catch (error) {
            console.warn('Tema okunamadi:', error);
        }

        applyTheme(storedTheme);
    }

    function isConfigReady() {
        return Boolean(apiKey) && !apiKey.includes('BURAYA') && globalChannels.some((channel) => {
                const hasId = channel.channelId && !channel.channelId.includes('BURAYA');
                const hasHandle = channel.channelHandle && !channel.channelHandle.includes('BURAYA');
                const hasUsername = channel.channelUsername && !channel.channelUsername.includes('BURAYA');
                return hasId || hasHandle || hasUsername;
        });
    }

    function createApiUrl(endpoint, params) {
        const url = new URL(`${API_BASE}/${endpoint}`);
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                url.searchParams.set(key, value);
            }
        });
        url.searchParams.set('key', apiKey);
        return url.toString();
    }

    async function fetchJson(endpoint, params) {
        const response = await fetch(createApiUrl(endpoint, params));
        const payload = await response.json();

        if (!response.ok || payload.error) {
            const message = payload && payload.error && payload.error.message
                ? payload.error.message
                : 'YouTube verisi alinamadi.';
            throw new Error(message);
        }

        return payload;
    }

    async function getUploadsPlaylistId(channelConfig) {
        const params = {
            part: 'contentDetails,snippet',
            maxResults: 1
        };

        if (channelConfig.channelId) {
            params.id = channelConfig.channelId;
        } else if (channelConfig.channelHandle) {
            params.forHandle = channelConfig.channelHandle;
        } else if (channelConfig.channelUsername) {
            params.forUsername = channelConfig.channelUsername;
        } else {
            return {
                uploadsPlaylistId: '',
                channelTitle: 'YouTube kanali'
            };
        }

        const payload = await fetchJson('channels', params);

        const channel = payload.items && payload.items[0];
        return {
            channelId: channel ? channel.id : '',
            uploadsPlaylistId: channel && channel.contentDetails && channel.contentDetails.relatedPlaylists
                ? channel.contentDetails.relatedPlaylists.uploads
                : '',
            channelTitle: channel && channel.snippet ? channel.snippet.title : 'YouTube kanali'
        };
    }

    async function getPlaylistVideos(playlistId, maxResults) {
        const payload = await fetchJson('playlistItems', {
            part: 'snippet,contentDetails',
            playlistId,
            maxResults: Math.min(maxResults, 50)
        });

        return Array.isArray(payload.items) ? payload.items : [];
    }

    async function getVideoDetails(videoIds) {
        if (!videoIds.length) {
            return new Map();
        }

        const payload = await fetchJson('videos', {
            part: 'contentDetails,statistics,snippet',
            id: videoIds.join(',')
        });

        return new Map((payload.items || []).map((item) => [item.id, item]));
    }

    function parseIsoDuration(value) {
        const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value || '');
        if (!match) {
            return '';
        }

        const hours = Number(match[1] || 0);
        const minutes = Number(match[2] || 0);
        const seconds = Number(match[3] || 0);
        const totalMinutes = hours * 60 + minutes;

        if (hours > 0) {
            return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }

        return `${String(totalMinutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function formatRelativeDate(isoDate) {
        const publishedAt = new Date(isoDate);
        if (Number.isNaN(publishedAt.getTime())) {
            return 'Bilinmeyen tarih';
        }

        return new Intl.DateTimeFormat('tr-TR', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        }).format(publishedAt);
    }

    function formatViewCount(value) {
        const count = Number(value || 0);
        if (!count) {
            return 'Yeni yuklendi';
        }

        return `${new Intl.NumberFormat('tr-TR', {
            notation: count >= 1000000 ? 'compact' : 'standard',
            maximumFractionDigits: count >= 1000000 ? 1 : 0
        }).format(count)} izlenme`;
    }

    function pickThumbnail(item, details) {
        const snippetThumbs = item && item.snippet && item.snippet.thumbnails ? item.snippet.thumbnails : {};
        const detailsThumbs = details && details.snippet && details.snippet.thumbnails ? details.snippet.thumbnails : {};
        return (snippetThumbs.maxres || detailsThumbs.maxres || snippetThumbs.high || detailsThumbs.high || snippetThumbs.medium || detailsThumbs.medium || snippetThumbs.default || detailsThumbs.default || {}).url || '';
    }

    async function loadChannelVideos(channelConfig, limit) {
        const channelMeta = await getUploadsPlaylistId(channelConfig);
        if (!channelMeta.uploadsPlaylistId) {
            return [];
        }

        const playlistItems = await getPlaylistVideos(channelMeta.uploadsPlaylistId, limit);
        const videoIds = playlistItems
            .map((item) => item.contentDetails && item.contentDetails.videoId)
            .filter(Boolean);
        const detailsMap = await getVideoDetails(videoIds);

        return playlistItems
            .filter((item) => item.snippet && item.snippet.resourceId && item.snippet.resourceId.videoId)
            .map((item) => {
                const videoId = item.snippet.resourceId.videoId;
                const details = detailsMap.get(videoId);
                return {
                    videoId,
                    title: item.snippet.title,
                    description: item.snippet.description || '',
                    channelTitle: channelConfig.label || channelMeta.channelTitle,
                    publishedAt: item.contentDetails && item.contentDetails.videoPublishedAt ? item.contentDetails.videoPublishedAt : item.snippet.publishedAt,
                    thumbnail: pickThumbnail(item, details),
                    duration: parseIsoDuration(details && details.contentDetails ? details.contentDetails.duration : ''),
                    viewCount: details && details.statistics ? details.statistics.viewCount : '',
                    url: `https://www.youtube.com/watch?v=${videoId}`
                };
            });
    }

    async function loadChannelPopularVideos(channelConfig, limit) {
        const sampleSize = Math.max(limit * 3, limit);
        const recentVideos = await loadChannelVideos(channelConfig, sampleSize);
        return recentVideos
            .slice()
            .sort((left, right) => Number(right.viewCount || 0) - Number(left.viewCount || 0))
            .slice(0, limit);
    }

    async function loadSection(sectionConfig) {
        const maxVideos = Math.max(1, Number(sectionConfig.maxVideos || defaultVideoLimit));
        const sourceMode = sectionConfig.source || 'newest';
        const channels = Array.isArray(sectionConfig.channels) && sectionConfig.channels.length
            ? sectionConfig.channels
            : globalChannels;
        const perChannelLimit = Math.max(1, Math.ceil(maxVideos / Math.max(channels.length, 1)));
        const channelResults = await Promise.all(
            channels.map((channel) => sourceMode === 'popular'
                ? loadChannelPopularVideos(channel, perChannelLimit)
                : loadChannelVideos(channel, perChannelLimit))
        );

        const merged = channelResults.flat();
        const unique = [];
        const seen = new Set();

        merged
            .sort((left, right) => {
                if (sourceMode === 'popular') {
                    return Number(right.viewCount || 0) - Number(left.viewCount || 0);
                }

                return new Date(right.publishedAt) - new Date(left.publishedAt);
            })
            .forEach((video) => {
                if (!seen.has(video.videoId)) {
                    seen.add(video.videoId);
                    unique.push(video);
                }
            });

        return unique.slice(0, maxVideos);
    }

    function escapeHtml(value) {
        return String(value || '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    function buildVideoCard(video) {
        const trendBadge = Number(video.viewCount || 0) >= 500000 ? '<span class="trend-flag">Trend</span>' : '';
        return `
            <article class="video-card" data-video-id="${escapeHtml(video.videoId)}" data-video-title="${escapeHtml(video.title)}" data-channel="${escapeHtml(video.channelTitle)}" data-video-url="${escapeHtml(video.url)}">
                <div class="thumbnail" style="background-image: url('${escapeHtml(video.thumbnail)}')">
                    <span class="video-badge">${escapeHtml(video.channelTitle)}</span>
                    ${trendBadge}
                    <span class="duration">${escapeHtml(video.duration || 'Canli')}</span>
                </div>
                <div class="card-info">
                    <h3>${escapeHtml(video.title)}</h3>
                    <div class="card-meta">
                        <p><i class="fas fa-user"></i> ${escapeHtml(video.channelTitle)}</p>
                        <p><i class="fas fa-calendar"></i> ${escapeHtml(formatRelativeDate(video.publishedAt))}</p>
                        <p><i class="fas fa-chart-line"></i> ${escapeHtml(formatViewCount(video.viewCount))}</p>
                    </div>
                    <div class="card-actions">
                        <button class="card-action primary-action" type="button" data-action="play">
                            <i class="fas fa-play"></i>
                            Oynat
                        </button>
                        <a class="card-action secondary-action" href="${escapeHtml(video.url)}" target="_blank" rel="noopener noreferrer" data-action="external">
                            <i class="fab fa-youtube"></i>
                            YouTube
                        </a>
                    </div>
                </div>
            </article>
        `;
    }

    function renderEmptyState(rowElement, message) {
        rowElement.innerHTML = `
            <article class="video-card empty-card">
                <div class="card-info">
                    <h3>Akis bekleniyor</h3>
                    <p>${escapeHtml(message)}</p>
                </div>
            </article>
        `;
    }

    function loadRecentVideos() {
        try {
            const raw = window.localStorage.getItem(RECENT_KEY);
            recentVideos = raw ? JSON.parse(raw) : [];
        } catch (error) {
            console.warn('Son izlenenler okunamadi:', error);
            recentVideos = [];
        }
    }

    function saveRecentVideos() {
        try {
            window.localStorage.setItem(RECENT_KEY, JSON.stringify(recentVideos.slice(0, MAX_RECENT)));
        } catch (error) {
            console.warn('Son izlenenler kaydedilemedi:', error);
        }
    }

    function renderRecentVideos() {
        if (!recentRow) {
            return;
        }

        if (!recentVideos.length) {
            renderEmptyState(recentRow, 'Burada izledigin videolar birikecek.');
            return;
        }

        recentRow.innerHTML = recentVideos.map(buildVideoCard).join('');
        wireVideoCards();
    }

    function trackRecentVideo(video) {
        if (!video || !video.videoId) {
            return;
        }

        recentVideos = [video, ...recentVideos.filter((item) => item.videoId !== video.videoId)].slice(0, MAX_RECENT);
        saveRecentVideos();
        renderRecentVideos();
    }

    function wireVideoCards() {
        document.querySelectorAll('.video-card[data-video-id]').forEach((card) => {
            card.addEventListener('click', () => {
                playVideo(card.dataset.videoId, card.dataset.videoTitle);
            });
        });

        document.querySelectorAll('.card-action').forEach((action) => {
            action.addEventListener('click', (event) => {
                event.stopPropagation();
            });
        });

        document.querySelectorAll('.primary-action').forEach((button) => {
            button.addEventListener('click', (event) => {
                const card = event.currentTarget.closest('.video-card');
                if (!card) {
                    return;
                }

                playVideo(card.dataset.videoId, card.dataset.videoTitle);
            });
        });
    }

    function renderChannelFilters() {
        const labels = ['all', ...new Set(globalChannels.map((channel) => channel.label).filter(Boolean))];
        channelFilters.innerHTML = labels.map((label) => {
            const isActive = label === activeChannel;
            const text = label === 'all' ? 'Tum kanallar' : label;
            return `
                <button class="filter-chip${isActive ? ' is-active' : ''}" type="button" data-channel-filter="${escapeHtml(label)}">
                    ${escapeHtml(text)}
                </button>
            `;
        }).join('');

        channelFilters.querySelectorAll('.filter-chip').forEach((button) => {
            button.addEventListener('click', () => {
                activeChannel = button.dataset.channelFilter;
                renderChannelFilters();
                renderChannelSpotlights();
                renderSections();
            });
        });
    }

    function renderThemePicker() {
        if (!themePicker) {
            return;
        }

        const currentTheme = document.body.dataset.theme || THEMES[0].id;
        themePicker.innerHTML = THEMES.map((theme) => `
            <button class="theme-chip${theme.id === currentTheme ? ' is-active' : ''}" type="button" data-theme-id="${escapeHtml(theme.id)}">
                <span class="theme-swatch ${escapeHtml(theme.id)}"></span>
                ${escapeHtml(theme.label)}
            </button>
        `).join('');

        themePicker.querySelectorAll('.theme-chip').forEach((button) => {
            button.addEventListener('click', () => {
                applyTheme(button.dataset.themeId);
                renderThemePicker();
            });
        });
    }

    function buildChannelStats() {
        const allVideos = [...sectionState.values()].flatMap((section) => section.videos || []);
        return globalChannels.map((channel) => {
            const label = channel.label || channel.channelHandle || 'Kanal';
            const videos = allVideos.filter((video) => video.channelTitle === label);
            const latest = videos.slice().sort((left, right) => new Date(right.publishedAt) - new Date(left.publishedAt))[0];
            const totalViews = videos.reduce((sum, video) => sum + Number(video.viewCount || 0), 0);
            return {
                label,
                handle: channel.channelHandle || '',
                latest,
                totalViews,
                count: videos.length
            };
        });
    }

    function renderChannelSpotlights() {
        if (!channelSpotlights) {
            return;
        }

        const stats = buildChannelStats();
        channelSpotlights.innerHTML = stats.map((item) => {
            const isActive = activeChannel === item.label;
            const preview = item.latest ? item.latest.title : 'Yeni videolar bekleniyor';
            const thumb = item.latest && item.latest.thumbnail ? `style="background-image:url('${escapeHtml(item.latest.thumbnail)}')"` : '';
            return `
                <article class="channel-card${isActive ? ' is-active' : ''}" data-spotlight-channel="${escapeHtml(item.label)}">
                    <div class="channel-art" ${thumb}></div>
                    <div class="channel-copy">
                        <p class="channel-handle">${escapeHtml(item.handle || item.label)}</p>
                        <h3>${escapeHtml(item.label)}</h3>
                        <p>${escapeHtml(preview)}</p>
                        <div class="channel-stats">
                            <span>${escapeHtml(String(item.count))} video</span>
                            <span>${escapeHtml(formatViewCount(item.totalViews))}</span>
                        </div>
                    </div>
                </article>
            `;
        }).join('');

        channelSpotlights.querySelectorAll('.channel-card').forEach((card) => {
            card.addEventListener('click', () => {
                const nextChannel = card.dataset.spotlightChannel;
                activeChannel = activeChannel === nextChannel ? 'all' : nextChannel;
                renderChannelFilters();
                renderChannelSpotlights();
                renderSections();
            });
        });
    }

    function renderSections() {
        for (const [sectionId, payload] of sectionState.entries()) {
            const row = document.getElementById(`row-${sectionId}`);
            if (!row) {
                continue;
            }

            const filteredVideos = activeChannel === 'all'
                ? payload.videos
                : payload.videos.filter((video) => video.channelTitle === activeChannel);

            if (!filteredVideos.length) {
                renderEmptyState(row, 'Secili kanal icin uygun video bulunamadi.');
                continue;
            }

            row.innerHTML = filteredVideos.map(buildVideoCard).join('');
        }

        wireVideoCards();
    }

    function loadCache() {
        try {
            const raw = window.localStorage.getItem(CACHE_KEY);
            if (!raw) {
                return null;
            }

            const parsed = JSON.parse(raw);
            if (!parsed.timestamp || (Date.now() - parsed.timestamp) > CACHE_TTL_MS) {
                return null;
            }

            return parsed;
        } catch (error) {
            console.warn('Cache okunamadi:', error);
            return null;
        }
    }

    function saveCache(payload) {
        try {
            window.localStorage.setItem(CACHE_KEY, JSON.stringify({
                timestamp: Date.now(),
                payload
            }));
        } catch (error) {
            console.warn('Cache yazilamadi:', error);
        }
    }

    function clearCache() {
        try {
            window.localStorage.removeItem(CACHE_KEY);
        } catch (error) {
            console.warn('Cache temizlenemedi:', error);
        }
    }

    function applyCachedSections(cachedSections) {
        sectionState.clear();
        for (const section of cachedSections) {
            sectionState.set(section.id, {
                title: section.title,
                videos: section.videos
            });
        }

        renderSections();

        const allVideos = cachedSections.flatMap((section) => section.videos || []);
        allVideos.sort((left, right) => new Date(right.publishedAt) - new Date(left.publishedAt));
        if (allVideos.length) {
            setHero(allVideos[0]);
        }
        setStatus(`Onbellekten ${allVideos.length} video yuklendi.`, 'success');
    }

    function setHero(video) {
        if (!video) {
            return;
        }

        heroTitle.textContent = video.title;
        heroDescription.innerHTML = `<i class="fas fa-fire"></i> ${escapeHtml(video.channelTitle)} kanalindan video. ${escapeHtml(formatRelativeDate(video.publishedAt))} tarihinde yayinlandi ve ${escapeHtml(formatViewCount(video.viewCount))}.`;
        if (video.thumbnail) {
            heroImage.src = video.thumbnail;
        }
        heroButton.disabled = false;
        heroButton.innerHTML = '<i class="fas fa-play"></i> Hemen izle';
        heroButton.onclick = function () {
            playVideo(video.videoId, video.title);
        };
        heroLink.href = video.url;
        heroLink.setAttribute('aria-disabled', 'false');
    }

    function createParticles() {
        for (let index = 0; index < 30; index += 1) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            particle.style.left = `${Math.random() * 100}%`;
            particle.style.top = `${Math.random() * 100}%`;
            particle.style.animationDuration = `${5 + Math.random() * 10}s`;
            document.body.appendChild(particle);
        }
    }

    window.playVideo = function playVideo(videoId, title) {
        const allKnownVideos = [
            ...recentVideos,
            ...[...sectionState.values()].flatMap((section) => section.videos || [])
        ];
        const selectedVideo = allKnownVideos.find((video) => video.videoId === videoId) || {
            videoId,
            title,
            channelTitle: activeChannel === 'all' ? 'GameVid' : activeChannel,
            publishedAt: new Date().toISOString(),
            thumbnail: '',
            duration: '',
            viewCount: '',
            url: `https://www.youtube.com/watch?v=${videoId}`
        };

        iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=0&enablejsapi=1`;
        playerTitle.innerHTML = `<i class="fas fa-play"></i> ${escapeHtml(title || 'Oyun videosu')}`;
        playerDiv.style.display = 'flex';
        trackRecentVideo(selectedVideo);

        if (!playerDiv.classList.contains('expanded')) {
            playerDiv.style.bottom = '30px';
            playerDiv.style.right = '30px';
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    window.closePlayer = function closePlayer() {
        playerDiv.style.display = 'none';
        iframe.src = '';
        playerDiv.classList.remove('expanded');
        playerDiv.style.bottom = '30px';
        playerDiv.style.right = '30px';
    };

    window.toggleExpand = function toggleExpand() {
        if (playerDiv.classList.contains('expanded')) {
            playerDiv.classList.remove('expanded');
            playerDiv.style.bottom = '30px';
            playerDiv.style.right = '30px';
        } else {
            playerDiv.classList.add('expanded');
            playerDiv.style.bottom = 'auto';
            playerDiv.style.right = 'auto';
        }
    };

    async function initFeed(options = {}) {
        const forceRefresh = Boolean(options.forceRefresh);

        if (!document.querySelector('.particle')) {
            createParticles();
        }

        hydrateTheme();
        renderChannelFilters();
        renderThemePicker();
        loadRecentVideos();
        renderRecentVideos();

        const rows = document.querySelectorAll('.js-dynamic-row');
        rows.forEach((row) => renderEmptyState(row, 'YouTube verileri yukleniyor.'));

        const cached = forceRefresh ? null : loadCache();
        if (cached && Array.isArray(cached.payload)) {
            applyCachedSections(cached.payload);
            renderChannelSpotlights();
            return;
        }

        if (!isConfigReady()) {
            rows.forEach((row) => renderEmptyState(row, 'youtube-config.js icinde API anahtari ve kanal handle veya kanal ID tanimla.'));
            setStatus('youtube-config.js dosyasina YouTube Data API anahtari ve kanal handle veya kanal ID bilgilerini ekle.', 'warning');
            return;
        }

        setStatus('YouTube kanallarindan son videolar cekiliyor...', 'loading');

        try {
            const allVideos = [];
            const cacheSections = [];

            for (const section of sections) {
                const row = document.getElementById(`row-${section.id}`);
                if (!row) {
                    continue;
                }

                const videos = await loadSection(section);
                if (!videos.length) {
                    renderEmptyState(row, 'Bu bolum icin uygun video bulunamadi.');
                    continue;
                }

                sectionState.set(section.id, {
                    title: section.title,
                    videos
                });
                cacheSections.push({
                    id: section.id,
                    title: section.title,
                    videos
                });
                allVideos.push(...videos);
            }

            renderSections();
            renderChannelSpotlights();
            allVideos.sort((left, right) => new Date(right.publishedAt) - new Date(left.publishedAt));
            setHero(allVideos[0]);
            saveCache(cacheSections);
            setStatus(`Toplam ${allVideos.length} video cekildi ve sayfaya eklendi.`, 'success');
        } catch (error) {
            console.error(error);
            rows.forEach((row) => renderEmptyState(row, 'YouTube baglantisi sirasinda hata olustu.'));
            setStatus(`YouTube hatasi: ${error.message}`, 'error');
        }
    }

    if (refreshFeedButton) {
        refreshFeedButton.addEventListener('click', async () => {
            clearCache();
            setStatus('Onbellek temizlendi. Akis yeniden yukleniyor...', 'loading');
            await initFeed({ forceRefresh: true });
        });
    }

    initFeed();
})();
