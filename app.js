// API Endpoints Configuration
const API_BASE = 'https://ophim1.com';
const IMAGE_DEFAULT_BASE = 'https://img.ophim.live/uploads/movies/';

// Application State
let currentType = 'home'; // home, phim-le, phim-bo, hoat-hinh, tv-shows, search
let currentPage = 1;
let totalPages = 1;
let searchKeyword = '';
let searchTimeout = null;

let currentMovie = null;
let currentServerIndex = 0;
let currentEpisodeIndex = 0;
let currentPlayerMode = 'embed'; // embed, hls
let hlsPlayerInstance = null;
let fsControlsTimeout = null;
let displayedSlugs = new Set();
let currentHeroMovie = null;
let heroPreviewMuted = localStorage.getItem('hero_preview_muted') !== 'false';
let activePreviewCard = null;
const movieDetailCache = new Map();
let hasUnlockedAutoplay = false;
let trailerObserver = null;

function stripHtml(value) {
    return String(value || '').replace(/<[^>]*>?/gm, '').trim();
}

function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[char]));
}

function getMovieEpisodeText(movie) {
    return movie.episode_current || movie.time || 'Đang cập nhật';
}

function renderCardInfoOverlay(movie, loadingText = '') {
    const description = stripHtml(movie.content || movie.description);
    const shortDescription = description ? description.slice(0, 150) : loadingText;
    const categoryText = Array.isArray(movie.category) ? movie.category.map(item => item.name).filter(Boolean).slice(0, 3).join(', ') : '';

    return `
        <div class="movie-card-hover-info">
            <div class="hover-info-main">
                <div class="hover-info-actions" aria-hidden="true">
                    <button class="hover-action-btn hover-action-primary" tabindex="-1"><i class="fas fa-play"></i></button>
                    <button class="hover-action-btn" tabindex="-1"><i class="fas fa-plus"></i></button>
                    <button class="hover-action-btn" tabindex="-1"><i class="fas fa-thumbs-up"></i></button>
                    <button class="hover-action-btn hover-action-more" tabindex="-1"><i class="fas fa-chevron-down"></i></button>
                </div>
                <h3 class="hover-info-title">${escapeHtml(movie.name || 'Đang cập nhật')}</h3>
                ${movie.origin_name ? `<p class="hover-info-subtitle">${escapeHtml(movie.origin_name)}</p>` : ''}
                <div class="hover-info-meta">
                    <span>${escapeHtml(movie.year || 'N/A')}</span>
                    <span>${escapeHtml(movie.quality || 'HD')}</span>
                    <span>${escapeHtml(movie.lang || 'Vietsub')}</span>
                </div>
                <p class="hover-info-episode">${escapeHtml(getMovieEpisodeText(movie))}</p>
                ${categoryText ? `<p class="hover-info-category">${escapeHtml(categoryText)}</p>` : ''}
                <p class="hover-info-desc">${escapeHtml(shortDescription || 'Đang tải thông tin phim...')}</p>
            </div>
        </div>
    `;
}

// Initialize on DOM Load
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

// App Entry Point
function initApp() {
    setupEventListeners();
    setupSliders();
    initEpisodeNavListeners();
    
    // Check if user is logged in
    const isLoggedIn = localStorage.getItem('netflix_logged_in') === 'true';
    if (isLoggedIn) {
        showMainApp();
    } else {
        showLandingPage();
    }
}

// Show/Hide page screens
function showMainApp() {
    const landingPage = document.getElementById('landingPage');
    const mainHeader = document.getElementById('mainHeader');
    const contentContainer = document.querySelector('.content-container');
    const footer = document.querySelector('.footer');

    if (landingPage) landingPage.style.display = 'none';
    if (mainHeader) mainHeader.style.display = 'flex';
    if (contentContainer) contentContainer.style.display = 'block';
    if (footer) footer.style.display = 'block';

    // Load initial movies if not loaded
    loadHomeData();

    // Check if there is an active movie watch session to restore on reload!
    checkAndRestoreActiveWatchState();
}

function showLandingPage() {
    const landingPage = document.getElementById('landingPage');
    const mainHeader = document.getElementById('mainHeader');
    const contentContainer = document.querySelector('.content-container');
    const footer = document.querySelector('.footer');

    if (landingPage) landingPage.style.display = 'block';
    if (mainHeader) mainHeader.style.display = 'none';
    if (contentContainer) contentContainer.style.display = 'none';
    if (footer) footer.style.display = 'none';
}

function unlockAutoplay() {
    if (hasUnlockedAutoplay) return;
    hasUnlockedAutoplay = true;

    if (currentType === 'home' && currentHeroMovie) {
        syncHeroPreview();
    }
}

// Helper: Parse YouTube URL to Video ID / Embed URL
function getYoutubeVideoId(url) {
    if (!url) return null;
    let videoId = '';
    
    // Check match for youtube.com/watch?v=ID or &v=ID
    const watchMatch = url.match(/(?:youtube\.com\/watch\?v=|&v=)([^&\s]+)/);
    if (watchMatch && watchMatch[1]) {
        videoId = watchMatch[1];
    } else {
        // Check match for youtu.be/ID
        const shortMatch = url.match(/youtu\.be\/([^?\s]+)/);
        if (shortMatch && shortMatch[1]) {
            videoId = shortMatch[1];
        } else {
            // Check match for youtube.com/embed/ID
            const embedMatch = url.match(/youtube\.com\/embed\/([^?\s]+)/);
            if (embedMatch && embedMatch[1]) {
                videoId = embedMatch[1];
            }
        }
    }
    
    return videoId || null;
}

function getYoutubeEmbedUrl(url, options = 0) {
    const videoId = getYoutubeVideoId(url);
    if (!videoId) return null;

    let autoplay = 0;
    let mute = 0;
    let controls = 1;
    let loop = 0;

    if (typeof options === 'number') {
        autoplay = options;
    } else {
        autoplay = options.autoplay || 0;
        mute = options.mute || 0;
        controls = options.controls ?? 1;
        loop = options.loop || 0;
    }

    const params = new URLSearchParams({
        autoplay: String(autoplay),
        mute: String(mute),
        controls: String(controls),
        enablejsapi: '1',
        rel: '0',
        playsinline: '1',
        modestbranding: '1',
        disablekb: '1',
        iv_load_policy: '3',
        fs: '0'
    });

    if (loop) {
        params.set('loop', '1');
        params.set('playlist', videoId);
    }

    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
        params.set('origin', window.location.origin);
        params.set('widget_referrer', window.location.href);
    } else {
        return null;
    }

    return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}

// --- Search History Manager ---
function getSearchHistory() {
    try {
        return JSON.parse(localStorage.getItem('ranphim_search_history') || '[]');
    } catch (e) {
        return [];
    }
}

function saveSearchQueryToHistory(query) {
    if (!query || !query.trim()) return;
    const cleanQuery = query.trim();
    let history = getSearchHistory();
    history = history.filter(item => item.toLowerCase() !== cleanQuery.toLowerCase());
    history.unshift(cleanQuery);
    if (history.length > 8) history = history.slice(0, 8);
    localStorage.setItem('ranphim_search_history', JSON.stringify(history));
    renderSearchHistoryDropdown();
}

function removeSearchHistoryItem(query) {
    let history = getSearchHistory();
    history = history.filter(item => item !== query);
    localStorage.setItem('ranphim_search_history', JSON.stringify(history));
    renderSearchHistoryDropdown();
}

function clearAllSearchHistory() {
    localStorage.removeItem('ranphim_search_history');
    renderSearchHistoryDropdown();
}

function renderSearchHistoryDropdown() {
    const historyList = document.getElementById('searchHistoryList');
    const dropdown = document.getElementById('searchHistoryDropdown');
    if (!historyList || !dropdown) return;

    const history = getSearchHistory();
    if (history.length === 0) {
        dropdown.classList.remove('open');
        return;
    }

    historyList.innerHTML = '';
    history.forEach(query => {
        const item = document.createElement('div');
        item.className = 'search-history-item';
        item.innerHTML = `
            <div class="history-text-wrap">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span class="history-query">${query}</span>
            </div>
            <button class="delete-history-btn" title="Xóa mốc này">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        `;

        item.querySelector('.history-text-wrap').addEventListener('click', () => {
            const input = document.getElementById('searchInput');
            const searchBox = document.getElementById('searchBox');
            input.value = query;
            searchBox.classList.add('expanded', 'has-text');
            document.getElementById('searchClear').style.display = 'block';
            dropdown.classList.remove('open');
            performSearch(query);
        });

        item.querySelector('.delete-history-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            removeSearchHistoryItem(query);
        });

        historyList.appendChild(item);
    });
}

// Setup Event Listeners
function setupEventListeners() {
    document.addEventListener('pointerdown', unlockAutoplay, { once: true });
    document.addEventListener('keydown', unlockAutoplay, { once: true });

    // Header Scroll Effect
    const header = document.getElementById('mainHeader');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    });

    // Nav Links Tabs
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const type = link.getAttribute('data-type');
            if (type) {
                switchTab(type, link);
            }
        });
    });

    // Dropdown items (Genres Selection)
    const genreDropdownContainer = document.getElementById('genreDropdownContainer');
    const genreLink = document.getElementById('genreLink');
    const genreDropdownMenu = document.getElementById('genreDropdownMenu');

    genreLink.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        genreDropdownContainer.classList.toggle('open');
    });

    genreDropdownMenu.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    const dropdownItems = document.querySelectorAll('.dropdown-item');
    dropdownItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const slug = item.getAttribute('data-slug');
            const name = item.getAttribute('data-name');
            genreDropdownContainer.classList.remove('open');
            selectGenre(slug, name, item);
        });
    });

    // Logo click resets to home
    document.getElementById('logoLink').addEventListener('click', (e) => {
        e.preventDefault();
        const homeLink = document.querySelector('.nav-link[data-type="home"]');
        switchTab('home', homeLink);
    });

    // Search Toggle, Input & History Dropdown
    const searchBox = document.getElementById('searchBox');
    const searchBtn = document.getElementById('searchBtn');
    const searchInput = document.getElementById('searchInput');
    const searchClear = document.getElementById('searchClear');
    const searchHistoryDropdown = document.getElementById('searchHistoryDropdown');
    const clearSearchHistoryBtn = document.getElementById('clearSearchHistoryBtn');

    if (clearSearchHistoryBtn) {
        clearSearchHistoryBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearAllSearchHistory();
        });
    }

    searchBtn.addEventListener('click', () => {
        searchBox.classList.add('expanded');
        searchInput.focus();
    });

    searchBox.addEventListener('click', () => {
        searchBox.classList.add('expanded');
    });

    searchInput.addEventListener('focus', () => {
        renderSearchHistoryDropdown();
        if (getSearchHistory().length > 0) {
            if (searchHistoryDropdown) searchHistoryDropdown.classList.add('open');
        }
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const query = searchInput.value.trim();
            if (query) {
                saveSearchQueryToHistory(query);
                if (searchHistoryDropdown) searchHistoryDropdown.classList.remove('open');
                performSearch(query);
            }
        }
    });

    // Close search box & history dropdown if clicked outside
    document.addEventListener('click', (e) => {
        if (!searchBox.contains(e.target)) {
            if (searchInput.value.trim() === '') {
                searchBox.classList.remove('expanded');
            }
            if (searchHistoryDropdown) {
                searchHistoryDropdown.classList.remove('open');
            }
        }

        if (!genreDropdownContainer.contains(e.target)) {
            genreDropdownContainer.classList.remove('open');
        }
    });

    searchInput.addEventListener('input', () => {
        const value = searchInput.value;
        if (value.trim() !== '') {
            searchBox.classList.add('has-text');
        } else {
            searchBox.classList.remove('has-text');
        }

        // Debounce search API calls
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            performSearch(value.trim());
        }, 600);
    });

    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        searchBox.classList.remove('has-text');
        searchInput.focus();
        performSearch('');
    });

    document.getElementById('heroMuteBtn').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        heroPreviewMuted = !heroPreviewMuted;
        localStorage.setItem('hero_preview_muted', heroPreviewMuted ? 'true' : 'false');
        updateHeroMuteButton();

        if (!hasUnlockedAutoplay) {
            unlockAutoplay();
        }

        sendHeroPlayerCommand(heroPreviewMuted ? 'mute' : 'unMute');
        sendHeroPlayerCommand('setVolume', [heroPreviewMuted ? 0 : 100]);
    });

    // Modal Close
    document.getElementById('modalCloseBtn').addEventListener('click', closeMovieDetail);
    document.getElementById('detailModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('detailModal')) {
            closeMovieDetail();
        }
    });



    // Fullscreen Player Events
    document.getElementById('playerBackBtn').addEventListener('click', closeFullscreenPlayer);
    
    const fsPlayer = document.getElementById('fullscreenPlayer');
    fsPlayer.addEventListener('mousemove', showFsControls);
    fsPlayer.addEventListener('click', showFsControls);

    // Fullscreen Settings Cog Menu Toggle
    const fsGearBtn = document.getElementById('fsGearBtn');
    const fsSettingsMenu = document.getElementById('fsSettingsMenu');
    fsGearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fsSettingsMenu.classList.toggle('open');
    });

    // Close dropdown menu if click happens outside
    document.addEventListener('click', () => {
        fsSettingsMenu.classList.remove('open');
    });

    // Prevent click inside menu from closing it
    fsSettingsMenu.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // Server Option Selection
    document.getElementById('fsOptEmbed').addEventListener('click', () => {
        switchPlayerMode('embed');
        fsSettingsMenu.classList.remove('open');
    });
    document.getElementById('fsOptHls').addEventListener('click', () => {
        switchPlayerMode('hls');
        fsSettingsMenu.classList.remove('open');
    });

    // Fullscreen Toggle button
    const fsFullscreenBtn = document.getElementById('fsFullscreenBtn');
    fsFullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            fsPlayer.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable fullscreen: ${err.message}`);
            });
        } else {
            document.exitFullscreen();
        }
    });

    // Update fullscreen icon based on state
    document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement) {
            fsFullscreenBtn.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6m10-10h-6V4m0 16h6v-6M10 4H4v6"/></svg>`;
        } else {
            fsFullscreenBtn.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;
        }
    });

    // Mini Player / Picture-in-Picture Toggle
    const fsPipBtn = document.getElementById('fsPipBtn');
    if (fsPipBtn) {
        fsPipBtn.addEventListener('click', () => {
            const video = document.getElementById('fsHlsVideoPlayer');

            // If HLS mode and browser supports native PiP
            if (currentPlayerMode === 'hls' && video && document.pictureInPictureEnabled && video.readyState >= 1) {
                if (document.pictureInPictureElement) {
                    document.exitPictureInPicture().catch(e => console.log(e));
                    return;
                } else {
                    video.requestPictureInPicture().catch(e => {
                        console.log('Native PiP blocked/failed, switching to floating mini player:', e);
                        toggleInAppMiniPlayer();
                    });
                    return;
                }
            }

            // Otherwise, toggle floating mini player card inside app
            toggleInAppMiniPlayer();
        });
    }

    function toggleInAppMiniPlayer() {
        const fsPlayer = document.getElementById('fullscreenPlayer');
        const fsPipBtn = document.getElementById('fsPipBtn');

        fsPlayer.classList.toggle('mini-player');
        const isMini = fsPlayer.classList.contains('mini-player');

        if (isMini) {
            // Unlock page scroll so user can freely browse website while video plays in corner!
            document.body.style.overflow = '';
            if (fsPipBtn) {
                fsPipBtn.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
                fsPipBtn.setAttribute('title', 'Phóng to (Toàn màn hình)');
            }
        } else {
            // Lock page scroll for theater mode
            document.body.style.overflow = 'hidden';
            if (fsPipBtn) {
                fsPipBtn.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
                fsPipBtn.setAttribute('title', 'Thu nhỏ màn hình (Mini Player)');
            }
        }
    }

    // Pagination
    document.getElementById('prevPageBtn').addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            loadCategoryPage(currentType, currentPage);
        }
    });

    document.getElementById('nextPageBtn').addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            loadCategoryPage(currentType, currentPage);
        }
    });

    // Row Title & See All Card Click Events to navigate to the full Category/Genre list
    document.addEventListener('click', (e) => {
        const title = e.target.closest('.row-title');
        const seeAll = e.target.closest('.see-all-card');
        const target = title || seeAll;
        
        if (target) {
            const tab = target.getAttribute('data-tab');
            const genre = target.getAttribute('data-genre');
            const name = target.getAttribute('data-name');

            if (tab) {
                // Find matching main nav link
                const navLink = document.querySelector(`.nav-link[data-type="${tab}"]`);
                if (navLink) {
                    switchTab(tab, navLink);
                }
            } else if (genre && name) {
                // Find matching dropdown item if exists
                const dropdownItem = document.querySelector(`.dropdown-item[data-slug="${genre}"]`);
                if (dropdownItem) {
                    selectGenre(genre, name, dropdownItem);
                } else {
                    // Fallback
                    const dummyItem = document.createElement('button');
                    selectGenre(genre, name, dummyItem);
                }
            }
        }
    });

    // Landing Page Sign In (Bypass)
    const landingSignInBtn = document.getElementById('landingSignInBtn');
    if (landingSignInBtn) {
        landingSignInBtn.addEventListener('click', () => {
            localStorage.setItem('netflix_logged_in', 'true');
            showMainApp();
        });
    }

    const emailSignupForm = document.getElementById('emailSignupForm');
    if (emailSignupForm) {
        emailSignupForm.addEventListener('submit', (e) => {
            e.preventDefault();
            localStorage.setItem('netflix_logged_in', 'true');
            showMainApp();
        });
    }

    // Landing FAQ Accordion dropdown toggle behavior
    const faqQuestions = document.querySelectorAll('.faq-question');
    faqQuestions.forEach(q => {
        q.addEventListener('click', () => {
            const item = q.parentElement;
            const wasOpen = item.classList.contains('open');
            
            // Close all items first for single accordion behavior
            document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
            
            if (!wasOpen) {
                item.classList.add('open');
            }
        });
    });

    // Navbar Profile Click to Log Out
    const userProfile = document.querySelector('.user-profile');
    if (userProfile) {
        userProfile.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Bạn có muốn đăng xuất khỏi Rần Phim?')) {
                localStorage.removeItem('netflix_logged_in');
                showLandingPage();
            }
        });
    }
}



// Helper: Check if a movie has any valid streaming links (embed or m3u8)
function hasStreamingLinks(movie) {
    if (!movie.episodes || movie.episodes.length === 0) return false;
    return movie.episodes.some(server => {
        return server.server_data && server.server_data.length > 0 && server.server_data.some(ep => {
            return (ep.link_embed && ep.link_embed.trim() !== '') || (ep.link_m3u8 && ep.link_m3u8.trim() !== '');
        });
    });
}

function hasSourceInSummary(movie) {
    if (!movie) return false;

    const episodeCurrent = String(movie.episode_current || '').trim().toLowerCase();
    const lastEpisodes = Array.isArray(movie.last_episodes) ? movie.last_episodes : [];

    if (episodeCurrent.includes('trailer')) return false;
    if (!episodeCurrent && lastEpisodes.length === 0) return false;

    return lastEpisodes.length > 0 || episodeCurrent !== '';
}

function filterMoviesWithSource(movies) {
    return (movies || []).filter(hasSourceInSummary);
}

async function fetchMovieDetail(slug) {
    if (!slug) return null;
    if (movieDetailCache.has(slug)) {
        return movieDetailCache.get(slug);
    }

    const request = (async () => {
        const res = await fetchApi(`${API_BASE}/phim/${slug}`);
        if (!res || !res.movie) return null;

        const movie = res.movie;
        movie.episodes = res.episodes || [];
        return movie;
    })();

    movieDetailCache.set(slug, request);
    const movie = await request;

    if (!movie) {
        movieDetailCache.delete(slug);
    }

    return movie;
}

async function pickHeroMovie(movies) {
    const candidates = filterMoviesWithSource(movies).slice(0, 20);
    if (candidates.length === 0) return null;

    const today = new Date();
    const startOfYear = new Date(today.getFullYear(), 0, 0);
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dayOfYear = Math.floor((startOfToday - startOfYear) / 86400000);
    const startIndex = dayOfYear % candidates.length;

    for (let offset = 0; offset < candidates.length; offset++) {
        const movie = candidates[(startIndex + offset) % candidates.length];
        const fullMovie = await fetchMovieDetail(movie.slug);
        if (!fullMovie) continue;
        if (hasStreamingLinks(fullMovie) && getYoutubeEmbedUrl(fullMovie.trailer_url, { autoplay: 1, mute: 1, controls: 0, loop: 1 })) {
            return fullMovie;
        }
    }

    for (let offset = 0; offset < candidates.length; offset++) {
        const movie = candidates[(startIndex + offset) % candidates.length];
        const fullMovie = await fetchMovieDetail(movie.slug);
        if (!fullMovie) continue;
        if (hasStreamingLinks(fullMovie)) {
            return fullMovie;
        }
    }

    return null;
}

function updateHeroMuteButton() {
    const heroMuteBtn = document.getElementById('heroMuteBtn');
    const icon = heroMuteBtn.querySelector('i');

    heroMuteBtn.setAttribute('aria-label', heroPreviewMuted ? 'Bật tiếng trailer' : 'Tắt tiếng trailer');
    heroMuteBtn.setAttribute('title', heroPreviewMuted ? 'Bật tiếng trailer' : 'Tắt tiếng trailer');
    icon.className = heroPreviewMuted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
}

function sendHeroPlayerCommand(func, args = []) {
    const heroTrailerIframe = document.getElementById('heroTrailerIframe');
    if (!heroTrailerIframe || !heroTrailerIframe.contentWindow || !heroTrailerIframe.src) return;

    heroTrailerIframe.contentWindow.postMessage(JSON.stringify({
        event: 'command',
        func,
        args
    }), '*');
}

function stopHeroPreview() {
    const heroBanner = document.getElementById('heroBanner');
    const heroTrailerIframe = document.getElementById('heroTrailerIframe');

    heroTrailerIframe.src = '';
    heroBanner.classList.remove('has-preview');
}

function syncHeroPreview() {
    const heroBanner = document.getElementById('heroBanner');
    const heroTrailerIframe = document.getElementById('heroTrailerIframe');

    if (!currentHeroMovie || !currentHeroMovie.trailer_url) {
        stopHeroPreview();
        return;
    }

    const effectiveMute = hasUnlockedAutoplay ? heroPreviewMuted : 1;
    const previewUrl = getYoutubeEmbedUrl(currentHeroMovie.trailer_url, {
        autoplay: 1,
        mute: effectiveMute ? 1 : 0,
        controls: 0,
        loop: 1
    });

    if (!previewUrl) {
        stopHeroPreview();
        return;
    }

    heroTrailerIframe.onload = () => {
        sendHeroPlayerCommand(effectiveMute ? 'mute' : 'unMute');
        sendHeroPlayerCommand('setVolume', [effectiveMute ? 0 : 100]);
    };
    heroTrailerIframe.src = previewUrl;
    heroBanner.classList.add('has-preview');
    updateHeroMuteButton();
}

async function showCardPreview(card) {
    if (!card || !card.isConnected) return;
    if (activePreviewCard && activePreviewCard !== card) {
        hideCardPreview(activePreviewCard);
    }

    card.classList.add('preview-active');

    const movie = await fetchMovieDetail(card.getAttribute('data-slug'));
    if (!movie || activePreviewCard !== card) return;

    // Directly update the description element in DOM to prevent layout jumping
    const descEl = card.querySelector('.hover-info-desc');
    if (descEl) {
        const description = stripHtml(movie.content || movie.description || '');
        descEl.textContent = description ? description.slice(0, 150) + (description.length > 150 ? '...' : '') : 'Không có mô tả phim.';
    }
}

function hideCardPreview(card) {
    if (!card) return;

    clearTimeout(card.previewTimer);
    card.previewTimer = null;
    card.classList.remove('preview-active');

    if (activePreviewCard === card) {
        activePreviewCard = null;
    }
}

function attachPreviewBehavior(cards) {
    cards.forEach(card => {
        card.addEventListener('mouseenter', () => {
            clearTimeout(card.previewTimer);
            activePreviewCard = card;
            card.previewTimer = setTimeout(() => {
                showCardPreview(card);
            }, 250);
        });

        card.addEventListener('mouseleave', () => {
            hideCardPreview(card);
        });

        card.addEventListener('click', () => {
            hideCardPreview(card);
        });
    });
}

// Utility: Image URL Helper
function getImageUrl(url, pathPrefix = IMAGE_DEFAULT_BASE) {
    if (!url) return 'https://upload.wikimedia.org/wikipedia/commons/0/0b/Netflix-avatar.png';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return pathPrefix + url;
}

// Switch Navigation Tabs
function switchTab(type, clickedLink) {
    // UI state
    document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
    clickedLink.classList.add('active');

    // Remove active class from all dropdown items
    document.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('active'));

    // Reset Search input UI if switching tabs
    if (type !== 'search') {
        const searchBox = document.getElementById('searchBox');
        const searchInput = document.getElementById('searchInput');
        searchInput.value = '';
        searchBox.classList.remove('expanded', 'has-text');
    }

    currentType = type;
    currentPage = 1;

    // Toggle Content Sections
    const homeContent = document.getElementById('homeContent');
    const categorySection = document.getElementById('categorySection');
    const searchSection = document.getElementById('searchResultsSection');

    if (type === 'home') {
        homeContent.style.display = 'block';
        categorySection.style.display = 'none';
        searchSection.style.display = 'none';
        loadHomeData();
    } else {
        stopHeroPreview();
        homeContent.style.display = 'none';
        searchSection.style.display = 'none';
        categorySection.style.display = 'block';
        
        let title = 'Danh sách phim';
        if (type === 'phim-le') title = 'Phim Lẻ Chọn Lọc';
        else if (type === 'phim-bo') title = 'Phim Bộ Thịnh Hành';
        else if (type === 'hoat-hinh') title = 'Hoạt Hình & Anime';
        else if (type === 'tv-shows') title = 'TV Shows';
        
        document.getElementById('categoryTitle').textContent = title;
        loadCategoryPage(type, 1);
    }
}

// Select Genre from Dropdown Menu
function selectGenre(slug, name, item) {
    stopHeroPreview();
    // 1. Remove active class from all main nav links and add to the main Thể loại link
    document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
    document.getElementById('genreLink').classList.add('active');

    // 2. Remove active class from all dropdown items and add to the clicked item
    document.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');

    // 3. Clear Search input and status
    const searchBox = document.getElementById('searchBox');
    const searchInput = document.getElementById('searchInput');
    searchInput.value = '';
    searchBox.classList.remove('expanded', 'has-text');

    // 4. Toggle Content Sections
    const homeContent = document.getElementById('homeContent');
    const categorySection = document.getElementById('categorySection');
    const searchSection = document.getElementById('searchResultsSection');

    homeContent.style.display = 'none';
    searchSection.style.display = 'none';
    categorySection.style.display = 'block';

    // 5. Load and Render movies in grid
    document.getElementById('categoryTitle').textContent = name;
    currentType = 'genre-' + slug;
    currentPage = 1;
    loadCategoryPage(currentType, 1);
}

// Inject Skeletons for Loading State
function injectSkeletons(containerId, count = 6) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let html = '';
    for (let i = 0; i < count; i++) {
        html += `<div class="movie-card skeleton card-skeleton"></div>`;
    }
    container.innerHTML = html;
}

// Setup Slide Navigation Arrows
function setupSliders() {
    const rows = ['new', 'single', 'action', 'series', 'horror', 'anime', 'scifi', 'historical', 'comedy', 'romance', 'adventure', 'crime'];
    rows.forEach(row => {
        const track = document.getElementById(`track-${row}`);
        const prev = document.getElementById(`prev-${row}`);
        const next = document.getElementById(`next-${row}`);
        
        if (!track || !prev || !next) return;

        prev.addEventListener('click', () => {
            track.scrollBy({ left: -track.clientWidth * 0.75, behavior: 'smooth' });
        });

        next.addEventListener('click', () => {
            track.scrollBy({ left: track.clientWidth * 0.75, behavior: 'smooth' });
        });
    });
}

// Fetch Helper with Error Handler
async function fetchApi(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.json();
    } catch (e) {
        console.error('Fetch API failed:', e);
        return null;
    }
}

// Load Homepage Data (Newly updated, Single movies, Action, Series, Horror, Anime, SciFi, Costume, Comedy, Romance, Adventure, Crime)
async function loadHomeData() {
    // Reset displayed slugs to prevent duplications across rows
    displayedSlugs.clear();

    const YEAR = 2026;

    // Inject skeletons for all rows
    const rows = ['new', 'single', 'action', 'series', 'horror', 'anime', 'scifi', 'historical', 'comedy', 'romance', 'adventure', 'crime'];
    rows.forEach(row => injectSkeletons(`track-${row}`, 8));

    // 1. Newly updated
    const resNew = await fetchApi(`${API_BASE}/v1/api/danh-sach/phim-moi-cap-nhat?page=1&year=${YEAR}`);
    if (resNew && resNew.data && resNew.data.items && resNew.data.items.length > 0) {
        const cdn = resNew.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        const heroMovie = await pickHeroMovie(resNew.data.items);
        if (heroMovie) {
            renderHeroBanner(heroMovie);
        }
        renderTrack(resNew.data.items, 'track-new', getImageUrl, cdn);
    }

    // 2. Single Movies
    const resSingle = await fetchApi(`${API_BASE}/v1/api/danh-sach/phim-le?page=1&year=${YEAR}`);
    if (resSingle && resSingle.data) {
        const cdn = resSingle.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        renderTrack(resSingle.data.items, 'track-single', getImageUrl, cdn);
    }

    // 3. Action Movies (Genre)
    const resAction = await fetchApi(`${API_BASE}/v1/api/the-loai/hanh-dong?page=1&year=${YEAR}`);
    if (resAction && resAction.data) {
        const cdn = resAction.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        renderTrack(resAction.data.items, 'track-action', getImageUrl, cdn);
    }

    // 4. TV Series
    const resSeries = await fetchApi(`${API_BASE}/v1/api/danh-sach/phim-bo?page=1&year=${YEAR}`);
    if (resSeries && resSeries.data) {
        const cdn = resSeries.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        renderTrack(resSeries.data.items, 'track-series', getImageUrl, cdn);
    }

    // 5. Horror Movies (Genre)
    const resHorror = await fetchApi(`${API_BASE}/v1/api/the-loai/kinh-di?page=1&year=${YEAR}`);
    if (resHorror && resHorror.data) {
        const cdn = resHorror.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        renderTrack(resHorror.data.items, 'track-horror', getImageUrl, cdn);
    }

    // 6. Anime
    const resAnime = await fetchApi(`${API_BASE}/v1/api/danh-sach/hoat-hinh?page=1&year=${YEAR}`);
    if (resAnime && resAnime.data) {
        const cdn = resAnime.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        renderTrack(resAnime.data.items, 'track-anime', getImageUrl, cdn);
    }

    // 7. Sci-Fi Movies (Genre)
    const resSciFi = await fetchApi(`${API_BASE}/v1/api/the-loai/vien-tuong?page=1&year=${YEAR}`);
    if (resSciFi && resSciFi.data) {
        const cdn = resSciFi.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        renderTrack(resSciFi.data.items, 'track-scifi', getImageUrl, cdn);
    }

    // 8. Historical / Costume Movies (Genre)
    const resHist = await fetchApi(`${API_BASE}/v1/api/the-loai/co-trang?page=1&year=${YEAR}`);
    if (resHist && resHist.data) {
        const cdn = resHist.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        renderTrack(resHist.data.items, 'track-historical', getImageUrl, cdn);
    }

    // 9. Comedy Movies (Genre: hai-huoc)
    const resComedy = await fetchApi(`${API_BASE}/v1/api/the-loai/hai-huoc?page=1&year=${YEAR}`);
    if (resComedy && resComedy.data) {
        const cdn = resComedy.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        renderTrack(resComedy.data.items, 'track-comedy', getImageUrl, cdn);
    }

    // 10. Romance Movies (Genre: tinh-cam)
    const resRomance = await fetchApi(`${API_BASE}/v1/api/the-loai/tinh-cam?page=1&year=${YEAR}`);
    if (resRomance && resRomance.data) {
        const cdn = resRomance.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        renderTrack(resRomance.data.items, 'track-romance', getImageUrl, cdn);
    }

    // 11. Adventure Movies (Genre: phieu-luu)
    const resAdventure = await fetchApi(`${API_BASE}/v1/api/the-loai/phieu-luu?page=1&year=${YEAR}`);
    if (resAdventure && resAdventure.data) {
        const cdn = resAdventure.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        renderTrack(resAdventure.data.items, 'track-adventure', getImageUrl, cdn);
    }

    // 12. Crime Movies (Genre: hinh-su)
    const resCrime = await fetchApi(`${API_BASE}/v1/api/the-loai/hinh-su?page=1&year=${YEAR}`);
    if (resCrime && resCrime.data) {
        const cdn = resCrime.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        renderTrack(resCrime.data.items, 'track-crime', getImageUrl, cdn);
    }
}


// Render Featured Hero Banner
async function renderHeroBanner(movie) {
    if (!movie) return;

    let fullMovie = movie;
    if (!fullMovie.episodes) {
        fullMovie = await fetchMovieDetail(movie.slug);
        if (!fullMovie) return;
    }

    if (!hasStreamingLinks(fullMovie)) return;

    // Add to displayed slugs so it doesn't appear in rows
    displayedSlugs.add(fullMovie.slug);

    const heroBg = document.getElementById('heroBg');
    const heroTitle = document.getElementById('heroTitle');
    const heroSubTitle = document.getElementById('heroSubTitle');
    const heroOverview = document.getElementById('heroOverview');
    
    const year = document.getElementById('heroBadgeYear');
    const quality = document.getElementById('heroBadgeQuality');
    const lang = document.getElementById('heroBadgeLang');
    const type = document.getElementById('heroBadgeType');

    heroBg.src = fullMovie.poster_url ? fullMovie.poster_url : getImageUrl(fullMovie.thumb_url);
    heroTitle.textContent = fullMovie.name;
    heroSubTitle.textContent = fullMovie.origin_name;
    heroOverview.textContent = fullMovie.content.replace(/<[^>]*>?/gm, ''); // strip HTML tags
    
    year.textContent = fullMovie.year || '2026';
    quality.textContent = fullMovie.quality || 'HD';
    lang.textContent = fullMovie.lang || 'Vietsub';
    type.textContent = fullMovie.type === 'single' ? 'Phim Lẻ' : 'Phim Bộ';

    currentHeroMovie = fullMovie;
    syncHeroPreview();

    // Bind action buttons
    const playBtn = document.getElementById('heroPlayBtn');
    const infoBtn = document.getElementById('heroInfoBtn');

    // Remove old listeners
    const newPlayBtn = playBtn.cloneNode(true);
    const newInfoBtn = infoBtn.cloneNode(true);
    playBtn.parentNode.replaceChild(newPlayBtn, playBtn);
    infoBtn.parentNode.replaceChild(newInfoBtn, infoBtn);

    newPlayBtn.disabled = false;
    newPlayBtn.innerHTML = `<i class="fas fa-play"></i> Phát`;
    
    newPlayBtn.addEventListener('click', () => {
        openMovieDetail(fullMovie.slug, true);
    });

    newInfoBtn.addEventListener('click', () => {
        openMovieDetail(fullMovie.slug, false);
    });
}

// Render Track Carousels
function renderTrack(movies, trackId, imgHelper, cdnPath) {
    const track = document.getElementById(trackId);
    if (!track) return;

    if (!movies || movies.length === 0) {
        track.innerHTML = `<div class="error-msg">Không có dữ liệu phim</div>`;
        return;
    }

    // Filter out duplicate movies across homepage rows
    const uniqueMovies = [];
    movies.forEach(movie => {
        if (!displayedSlugs.has(movie.slug)) {
            uniqueMovies.push(movie);
            displayedSlugs.add(movie.slug);
        }
    });

    if (uniqueMovies.length === 0) {
        track.innerHTML = `<div class="error-msg">Không có phim mới</div>`;
        return;
    }

    let html = '';
    uniqueMovies.forEach(movie => {
        const imageUrl = imgHelper(movie.thumb_url || movie.poster_url, cdnPath);
        const movieYear = movie.year || 'N/A';
        const movieQuality = movie.quality || 'HD';
        const movieLang = movie.lang || 'Vietsub';

        const isComingSoon = movie.episode_current && (movie.episode_current.toLowerCase().includes('trailer') || (!movie.last_episodes || movie.last_episodes.length === 0));
        const badgeHtml = isComingSoon ? `<span class="card-badge-no-source">Chưa có</span>` : '';

        html += `
            <div class="movie-card" data-slug="${movie.slug}">
                ${badgeHtml}
                <img src="${imageUrl}" alt="${movie.name}" class="movie-card-img" loading="lazy">
                ${renderCardInfoOverlay(movie, 'Đang tải thông tin phim...')}
                <div class="movie-card-info">
                    <h3 class="card-title">${movie.name}</h3>
                    <div class="card-meta">
                        <span class="meta-year">${movieYear}</span>
                        <span class="meta-badge">${movieQuality}</span>
                        <span class="meta-badge">${movieLang}</span>
                    </div>
                </div>
            </div>
        `;
    });

    // Determine see-all target based on trackId to append a "Xem tất cả" card at the end of the horizontal track
    let seeAllAttr = '';
    if (trackId === 'track-single') seeAllAttr = 'data-tab="phim-le"';
    else if (trackId === 'track-series') seeAllAttr = 'data-tab="phim-bo"';
    else if (trackId === 'track-anime') seeAllAttr = 'data-tab="hoat-hinh"';
    else if (trackId === 'track-action') seeAllAttr = 'data-genre="hanh-dong" data-name="Phim Hành Động"';
    else if (trackId === 'track-horror') seeAllAttr = 'data-genre="kinh-di" data-name="Phim Kinh Dị"';
    else if (trackId === 'track-scifi') seeAllAttr = 'data-genre="vien-tuong" data-name="Phim Viễn Tưởng"';
    else if (trackId === 'track-historical') seeAllAttr = 'data-genre="co-trang" data-name="Phim Cổ Trang"';
    else if (trackId === 'track-comedy') seeAllAttr = 'data-genre="hai-huoc" data-name="Phim Hài Hước"';
    else if (trackId === 'track-romance') seeAllAttr = 'data-genre="tinh-cam" data-name="Phim Tình Cảm"';
    else if (trackId === 'track-adventure') seeAllAttr = 'data-genre="phieu-luu" data-name="Phim Phiêu Lưu"';
    else if (trackId === 'track-crime') seeAllAttr = 'data-genre="hinh-su" data-name="Phim Hình Sự"';

    if (seeAllAttr) {
        html += `
            <div class="movie-card see-all-card" ${seeAllAttr}>
                <div class="see-all-content">
                    <i class="fas fa-arrow-circle-right"></i>
                    <span>Xem tất cả</span>
                </div>
            </div>
        `;
    }

    track.innerHTML = html;

    // Attach Click Events to Cards (excluding the See All card)
    const cards = track.querySelectorAll('.movie-card:not(.see-all-card)');
    attachPreviewBehavior(cards);
    cards.forEach(card => {
        card.addEventListener('click', () => {
            const slug = card.getAttribute('data-slug');
            if (slug) openMovieDetail(slug);
        });
    });
}

// Load Categorized Lists with Pagination
async function loadCategoryPage(type, page) {
    const grid = document.getElementById('categoryGrid');
    injectSkeletons('categoryGrid', 12);
    
    // Scroll window to top immediately on loading category page
    window.scrollTo({ top: 0, behavior: 'instant' });
    
    // Disable pagination buttons while loading
    document.getElementById('prevPageBtn').disabled = true;
    document.getElementById('nextPageBtn').disabled = true;

    let url = '';
    if (type.startsWith('genre-')) {
        const genreSlug = type.replace('genre-', '');
        url = `${API_BASE}/v1/api/the-loai/${genreSlug}?page=${page}`;
    } else {
        url = `${API_BASE}/v1/api/danh-sach/${type}?page=${page}`;
    }

    const res = await fetchApi(url);
    if (res && res.status === 'success' && res.data) {
        const data = res.data;
        const cdn = data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        
        renderGrid(data.items, 'categoryGrid', getImageUrl, cdn);

        // Update Pagination Status
        currentPage = page;
        const pagination = data.params.pagination;
        const totalItems = pagination.totalItems || 0;
        const itemsPerPage = pagination.totalItemsPerPage || 24;
        totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

        document.getElementById('pageNumber').textContent = `Trang ${currentPage} / ${totalPages}`;
        
        // Re-enable/configure pagination buttons
        document.getElementById('prevPageBtn').disabled = currentPage <= 1;
        document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;
    } else {
        grid.innerHTML = `<div class="error-msg">Không thể tải dữ liệu. Vui lòng thử lại sau.</div>`;
    }
}

// Render Grid (for search results and tabs)
function renderGrid(movies, gridId, imgHelper, cdnPath) {
    const grid = document.getElementById(gridId);
    if (!grid) return;

    if (!movies || movies.length === 0) {
        grid.innerHTML = `<div class="error-msg">Không tìm thấy phim phù hợp</div>`;
        return;
    }

    let html = '';
    movies.forEach(movie => {
        const imageUrl = imgHelper(movie.thumb_url || movie.poster_url, cdnPath);
        const movieYear = movie.year || 'N/A';
        const movieQuality = movie.quality || 'HD';
        const movieLang = movie.lang || 'Vietsub';

        const isComingSoon = movie.episode_current && (movie.episode_current.toLowerCase().includes('trailer') || (!movie.last_episodes || movie.last_episodes.length === 0));
        const badgeHtml = isComingSoon ? `<span class="card-badge-no-source">Chưa có</span>` : '';

        html += `
            <div class="movie-card" data-slug="${movie.slug}">
                ${badgeHtml}
                <img src="${imageUrl}" alt="${movie.name}" class="movie-card-img" loading="lazy">
                ${renderCardInfoOverlay(movie, 'Đang tải thông tin phim...')}
                <div class="movie-card-info">
                    <h3 class="card-title">${movie.name}</h3>
                    <div class="card-meta">
                        <span class="meta-year">${movieYear}</span>
                        <span class="meta-badge">${movieQuality}</span>
                        <span class="meta-badge">${movieLang}</span>
                    </div>
                </div>
            </div>
        `;
    });

    grid.innerHTML = html;

    // Attach Click Events
    const cards = grid.querySelectorAll('.movie-card');
    attachPreviewBehavior(cards);
    cards.forEach(card => {
        card.addEventListener('click', () => {
            const slug = card.getAttribute('data-slug');
            openMovieDetail(slug);
        });
    });
}

// Perform Search
async function performSearch(keyword) {
    searchKeyword = keyword;
    const homeContent = document.getElementById('homeContent');
    const categorySection = document.getElementById('categorySection');
    const searchSection = document.getElementById('searchResultsSection');
    const searchTitle = document.getElementById('searchTitle');
    const grid = document.getElementById('searchResultsGrid');

    if (keyword === '') {
        // Clear search, return to previous section
        searchSection.style.display = 'none';
        if (currentType === 'home') {
            homeContent.style.display = 'block';
            syncHeroPreview();
        } else {
            categorySection.style.display = 'block';
        }
        return;
    }

    // Save search query to history
    saveSearchQueryToHistory(keyword);

    // Enter Search Mode UI
    stopHeroPreview();
    homeContent.style.display = 'none';
    categorySection.style.display = 'none';
    searchSection.style.display = 'block';
    searchTitle.textContent = `Kết quả tìm kiếm cho "${keyword}"`;
    
    injectSkeletons('searchResultsGrid', 12);

    const res = await fetchApi(`${API_BASE}/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword)}&limit=24`);
    if (res && res.status === 'success' && res.data) {
        const cdn = res.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        renderGrid(res.data.items, 'searchResultsGrid', getImageUrl, cdn);
    } else {
        grid.innerHTML = `<div class="error-msg">Lỗi kết nối khi tìm kiếm phim.</div>`;
    }
}

// Open Movie Detail Modal
// Setup intersection observer to autoplay modal trailer when scrolled into view
function setupTrailerAutoplayObserver() {
    const modal = document.getElementById('detailModal');
    const iframe = document.getElementById('modalTrailerIframe');
    const section = document.getElementById('modalTrailerSection');

    if (!modal || !iframe || !section) return;

    if (trailerObserver) {
        trailerObserver.disconnect();
    }

    trailerObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!iframe.src || iframe.src === 'about:blank') return;

            if (entry.isIntersecting) {
                // Autoplay and mute when scrolled into view
                if (!iframe.src.includes('autoplay=1')) {
                    const videoId = getYoutubeVideoId(iframe.src);
                    if (videoId) {
                        const embedUrl = getYoutubeEmbedUrl(iframe.src, { autoplay: 1, mute: 1 });
                        if (embedUrl) iframe.src = embedUrl;
                    }
                }
            } else {
                // Pause/stop when scrolled out of view
                if (iframe.src.includes('autoplay=1')) {
                    const videoId = getYoutubeVideoId(iframe.src);
                    if (videoId) {
                        const embedUrl = getYoutubeEmbedUrl(iframe.src, { autoplay: 0, mute: 1 });
                        if (embedUrl) iframe.src = embedUrl;
                    }
                }
            }
        });
    }, {
        root: modal,
        threshold: 0.35 // trigger when 35% of the trailer block is visible in the scroll container
    });

    trailerObserver.observe(section);
}

// Open Movie Detail Modal
async function openMovieDetail(slug, autoPlay = false) {
    stopHeroPreview();
    const modal = document.getElementById('detailModal');
    
    // Reset Modal Content fields
    document.getElementById('modalMovieTitle').textContent = 'Đang tải...';
    document.getElementById('modalMovieSubTitle').textContent = '';
    document.getElementById('modalOverview').textContent = '';
    document.getElementById('modalBannerImg').src = '';
    document.getElementById('episodesSection').style.display = 'none';

    // Reset Trailer state
    document.getElementById('modalTrailerSection').style.display = 'none';
    document.getElementById('modalTrailerIframe').src = '';
    
    // Close fullscreen player if active
    closeFullscreenPlayer();

    // Show Modal Overlay
    modal.classList.add('active');
    document.body.style.overflow = 'hidden'; // Lock background scroll

    // Fetch Details
    const res = await fetchApi(`${API_BASE}/phim/${slug}`);
    if (!res || !res.movie) {
        document.getElementById('modalMovieTitle').textContent = 'Không tìm thấy dữ liệu bộ phim!';
        return;
    }

    currentMovie = res.movie;
    currentMovie.episodes = res.episodes || [];

    // Fill details
    document.getElementById('modalMovieTitle').textContent = currentMovie.name;
    document.getElementById('modalMovieSubTitle').textContent = currentMovie.origin_name;
    document.getElementById('modalOverview').textContent = currentMovie.content.replace(/<[^>]*>?/gm, '') || 'Không có mô tả cho bộ phim này.';
    document.getElementById('modalBannerImg').src = currentMovie.poster_url ? currentMovie.poster_url : getImageUrl(currentMovie.thumb_url);

    document.getElementById('modalYear').textContent = currentMovie.year || '2026';
    document.getElementById('modalQuality').textContent = currentMovie.quality || 'HD';
    document.getElementById('modalLang').textContent = currentMovie.lang || 'Vietsub';
    document.getElementById('modalTime').textContent = currentMovie.time || 'N/A';

    // Meta details
    document.getElementById('modalDirector').textContent = currentMovie.director ? currentMovie.director.join(', ') : 'Đang cập nhật';
    document.getElementById('modalActors').textContent = currentMovie.actor ? currentMovie.actor.join(', ') : 'Đang cập nhật';
    
    const categories = currentMovie.category ? currentMovie.category.map(c => c.name).join(', ') : 'Đang cập nhật';
    document.getElementById('modalCategories').textContent = categories;

    const countries = currentMovie.country ? currentMovie.country.map(c => c.name).join(', ') : 'Đang cập nhật';
    document.getElementById('modalCountries').textContent = countries;

    // Generate random match score to mimic Netflix
    const randomMatch = Math.floor(Math.random() * 15) + 85;
    document.getElementById('modalMatchScore').textContent = `${randomMatch}% Trùng khớp`;

    // Load and show Trailer directly above episodes by default if present
    if (currentMovie.trailer_url) {
        const embedUrl = getYoutubeEmbedUrl(currentMovie.trailer_url, { autoplay: 0, mute: 1 });
        if (embedUrl) {
            document.getElementById('modalTrailerSection').style.display = 'block';
            document.getElementById('modalTrailerIframe').src = embedUrl;
            setupTrailerAutoplayObserver();
        }
    }

    // Episodes & Servers Section
    setupEpisodesAndServers(autoPlay);

    // Bind "Phát" or "Xem tiếp" button
    const playBtn = document.getElementById('modalPlayBtn');
    const newPlayBtn = playBtn.cloneNode(true);
    playBtn.parentNode.replaceChild(newPlayBtn, playBtn);
    
    const hasSource = hasStreamingLinks(currentMovie);
    if (!hasSource) {
        newPlayBtn.disabled = true;
        newPlayBtn.innerHTML = `<i class="fas fa-exclamation-circle"></i> Chưa có nguồn`;
    } else {
        newPlayBtn.disabled = false;
        const saved = getSavedWatchProgress(currentMovie.slug);
        if (saved && saved.episodeIndex !== undefined) {
            newPlayBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="margin-right:6px;"><path d="M8 5v14l11-7z"/></svg> Xem tiếp (Tập ${saved.episodeIndex + 1})`;
            newPlayBtn.addEventListener('click', () => {
                playEpisode(saved.serverIndex || 0, saved.episodeIndex || 0, saved.currentTime);
            });
        } else {
            newPlayBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="margin-right:6px;"><path d="M8 5v14l11-7z"/></svg> Phát`;
            newPlayBtn.addEventListener('click', () => {
                playEpisode(0, 0);
            });
        }
    }
}

// Setup Episodes List & Server Navigation
function setupEpisodesAndServers(autoPlay) {
    const episodes = currentMovie.episodes;
    const epsSection = document.getElementById('episodesSection');
    const serverTabs = document.getElementById('serverTabs');

    if (!episodes || episodes.length === 0 || !episodes[0].server_data || episodes[0].server_data.length === 0) {
        epsSection.style.display = 'none';
        return;
    }

    // If the movie has only 1 episode, hide the episodes section (clutter-free) but still support autoplay
    if (episodes[0].server_data.length <= 1) {
        epsSection.style.display = 'none';
        if (autoPlay) {
            playEpisode(0, 0);
        }
        return;
    }

    epsSection.style.display = 'block';
    
    // Render Server Tabs
    let tabsHtml = '';
    episodes.forEach((server, index) => {
        tabsHtml += `
            <button class="server-tab ${index === 0 ? 'active' : ''}" data-index="${index}">
                ${server.server_name || `Server #${index + 1}`}
            </button>
        `;
    });
    serverTabs.innerHTML = tabsHtml;

    // Render Episodes for First Server
    renderEpisodesList(0);

    // Tab switcher events
    const tabs = serverTabs.querySelectorAll('.server-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const serverIndex = parseInt(tab.getAttribute('data-index'));
            renderEpisodesList(serverIndex);
        });
    });

    if (autoPlay) {
        playEpisode(0, 0);
    }
}

// Render Episodes List for chosen server
function renderEpisodesList(serverIndex) {
    currentServerIndex = serverIndex;
    const server = currentMovie.episodes[serverIndex];
    const epsGrid = document.getElementById('episodesGrid');

    if (!server || !server.server_data) return;

    let html = '';
    server.server_data.forEach((ep, index) => {
        const isActive = (currentServerIndex === serverIndex && currentEpisodeIndex === index && document.getElementById('fullscreenPlayer').style.display === 'flex');
        html += `
            <button class="episode-btn ${isActive ? 'active' : ''}" data-index="${index}" title="${ep.filename}">
                Tập ${ep.name}
            </button>
        `;
    });
    epsGrid.innerHTML = html;

    // Bind episode clicks
    const btns = epsGrid.querySelectorAll('.episode-btn');
    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            const index = parseInt(btn.getAttribute('data-index'));
            playEpisode(serverIndex, index);
        });
    });
}

// --- Watch Progress & Resume History ---
function getSavedWatchProgress(movieSlug) {
    try {
        const progress = JSON.parse(localStorage.getItem('ranphim_progress') || '{}');
        return progress[movieSlug] || null;
    } catch (e) {
        return null;
    }
}

function saveWatchProgress(movieSlug, serverIndex, episodeIndex, currentTime) {
    if (!movieSlug || isNaN(currentTime) || currentTime < 5) return;
    try {
        const progress = JSON.parse(localStorage.getItem('ranphim_progress') || '{}');
        progress[movieSlug] = {
            serverIndex,
            episodeIndex,
            currentTime: Math.floor(currentTime),
            updatedAt: Date.now()
        };
        localStorage.setItem('ranphim_progress', JSON.stringify(progress));
    } catch (e) {}
}

// --- URL State & Active Watch Session Restoration ---
function setWatchUrlState(slug, episodeIndex, serverIndex) {
    if (slug) {
        history.replaceState(null, '', `#watch?movie=${slug}&ep=${(episodeIndex || 0) + 1}&srv=${serverIndex || 0}`);
    } else {
        if (window.location.hash.startsWith('#watch')) {
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }
    }
}

function saveLastActiveWatch(movieSlug, serverIndex, episodeIndex, currentTime) {
    if (!movieSlug || isNaN(currentTime)) return;
    try {
        const activeState = {
            slug: movieSlug,
            serverIndex: serverIndex || 0,
            episodeIndex: episodeIndex || 0,
            currentTime: Math.floor(currentTime),
            timestamp: Date.now()
        };
        localStorage.setItem('ranphim_last_active', JSON.stringify(activeState));
        saveWatchProgress(movieSlug, serverIndex, episodeIndex, currentTime);
    } catch (e) {}
}

function clearLastActiveWatch() {
    try {
        localStorage.removeItem('ranphim_last_active');
    } catch (e) {}
    setWatchUrlState(null);
}

async function checkAndRestoreActiveWatchState() {
    const hash = window.location.hash;
    let slugToRestore = null;
    let epIndexToRestore = 0;
    let srvIndexToRestore = 0;

    if (hash.startsWith('#watch?')) {
        const params = new URLSearchParams(hash.substring(7));
        slugToRestore = params.get('movie');
        const epNum = parseInt(params.get('ep'));
        if (!isNaN(epNum) && epNum > 0) epIndexToRestore = epNum - 1;
        const srvNum = parseInt(params.get('srv'));
        if (!isNaN(srvNum)) srvIndexToRestore = srvNum;
    }

    if (!slugToRestore) {
        try {
            const lastActive = JSON.parse(localStorage.getItem('ranphim_last_active') || 'null');
            if (lastActive && lastActive.slug && (Date.now() - lastActive.timestamp < 3 * 3600 * 1000)) {
                slugToRestore = lastActive.slug;
                epIndexToRestore = lastActive.episodeIndex || 0;
                srvIndexToRestore = lastActive.serverIndex || 0;
            }
        } catch (e) {}
    }

    if (slugToRestore) {
        console.log('Auto restoring active movie watch state:', slugToRestore, epIndexToRestore);
        await openMovieDetail(slugToRestore, false);
        if (currentMovie && currentMovie.episodes && currentMovie.episodes[srvIndexToRestore]) {
            const saved = getSavedWatchProgress(slugToRestore);
            const seekTime = (saved && saved.episodeIndex === epIndexToRestore) ? saved.currentTime : 0;
            playEpisode(srvIndexToRestore, epIndexToRestore, seekTime);
        }
    }
}

let pendingSeekTime = null;

function showResumeToast(seekTime) {
    let toast = document.getElementById('fsResumeToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'fsResumeToast';
        toast.className = 'fs-resume-toast';
        document.getElementById('fullscreenPlayer').appendChild(toast);
    }

    toast.innerHTML = `
        <span>▶ Đã tiếp tục từ <strong>${formatTime(seekTime)}</strong></span>
        <button id="fsRestartBtn">Xem từ đầu</button>
    `;
    toast.classList.add('show');

    document.getElementById('fsRestartBtn').onclick = () => {
        const video = document.getElementById('fsHlsVideoPlayer');
        if (video) video.currentTime = 0;
        toast.classList.remove('show');
    };

    setTimeout(() => {
        toast.classList.remove('show');
    }, 4500);
}

function showCenterRipple(type) {
    const container = document.querySelector('.fs-video-container');
    if (!container) return;

    let ripple = document.getElementById('fsCenterRipple');
    if (!ripple) {
        ripple = document.createElement('div');
        ripple.id = 'fsCenterRipple';
        ripple.className = 'center-play-ripple';
        container.appendChild(ripple);
    }

    if (type === 'play') {
        ripple.innerHTML = `<svg width="44" height="44" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
    } else {
        ripple.innerHTML = `<svg width="44" height="44" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
    }

    ripple.classList.remove('animate');
    void ripple.offsetWidth;
    ripple.classList.add('animate');
}

function togglePlayPause() {
    const video = document.getElementById('fsHlsVideoPlayer');
    if (!video) return;
    if (video.paused) {
        video.play().catch(e => console.log('Play error:', e));
        showCenterRipple('play');
    } else {
        video.pause();
        showCenterRipple('pause');
    }
}

// Play Selected Episode in Fullscreen Theater Mode
function playEpisode(serverIndex, episodeIndex, forcedSeekTime) {
    currentServerIndex = serverIndex;
    currentEpisodeIndex = episodeIndex;

    const server = currentMovie.episodes[serverIndex];
    if (!server || !server.server_data) return;
    
    const ep = server.server_data[episodeIndex];
    if (!ep) return;

    if (forcedSeekTime !== undefined && forcedSeekTime !== null) {
        pendingSeekTime = forcedSeekTime;
    } else if (currentMovie && currentMovie.slug) {
        const saved = getSavedWatchProgress(currentMovie.slug);
        if (saved && saved.serverIndex === serverIndex && saved.episodeIndex === episodeIndex && saved.currentTime > 5) {
            pendingSeekTime = saved.currentTime;
        } else {
            pendingSeekTime = null;
        }
    }

    // Open Fullscreen Theater Player
    const fsPlayer = document.getElementById('fullscreenPlayer');
    // Robust parsing for episode title to prevent API bugs (e.g. empty or trailing "Tập ")
    let epTitle = '';
    const trimmedFilename = (ep.filename || '').trim();
    if (trimmedFilename && trimmedFilename.toLowerCase() !== 'tập') {
        epTitle = trimmedFilename;
    } else if (ep.name) {
        const nameStr = String(ep.name).trim();
        epTitle = nameStr.toLowerCase().startsWith('tập') ? nameStr : `Tập ${nameStr}`;
    } else {
        epTitle = 'Tập Full';
    }

    document.getElementById('playerMovieTitle').textContent = `${currentMovie.name} - ${epTitle}`;
    setWatchUrlState(currentMovie.slug, episodeIndex, serverIndex);
    fsPlayer.style.display = 'flex';
    document.body.style.overflow = 'hidden'; // Ensure body scroll lock

    // Highlight current active episode in modal grid
    const epBtns = document.querySelectorAll('.episode-btn');
    epBtns.forEach(btn => {
        const btnIndex = parseInt(btn.getAttribute('data-index'));
        if (btnIndex === episodeIndex) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Reset controls auto-hide timer
    showFsControls();

    // Update episode navigation UI
    updateEpisodeNavUI();

    // Load Stream Source in fullscreen player
    loadVideoSource(ep.link_embed, ep.link_m3u8);
}

// Update prev/next buttons, episode panel, and next-ep overlay based on current episode
function updateEpisodeNavUI() {
    if (!currentMovie || !currentMovie.episodes) return;
    const server = currentMovie.episodes[currentServerIndex];
    if (!server || !server.server_data) return;
    const totalEps = server.server_data.length;

    // Prev / Next nav buttons
    const prevBtn = document.getElementById('fsPrevEpBtn');
    const nextBtn = document.getElementById('fsNextEpBtn');
    const epNav = document.getElementById('fsEpNav');

    if (totalEps > 1) {
        epNav.style.display = 'flex';
        prevBtn.disabled = currentEpisodeIndex <= 0;
        nextBtn.disabled = currentEpisodeIndex >= totalEps - 1;
    } else {
        epNav.style.display = 'none';
    }

    // Close panel on episode switch (don't auto-open)
    closeEpPanel();

    // Episode panel grid
    const panelGrid = document.getElementById('fsEpPanelGrid');
    panelGrid.innerHTML = '';
    server.server_data.forEach((ep, idx) => {
        const epLabel = ep.name || `Tập ${idx + 1}`;
        const btn = document.createElement('button');
        btn.className = 'fs-ep-panel-btn' + (idx === currentEpisodeIndex ? ' active' : '');
        btn.textContent = epLabel;
        btn.addEventListener('click', () => {
            closeEpPanel();
            playEpisode(currentServerIndex, idx);
        });
        panelGrid.appendChild(btn);
    });

    // Scroll active episode into view — only when panel is open to avoid browser revealing it
    setTimeout(() => {
        const panel = document.getElementById('fsEpPanel');
        if (!panel.classList.contains('open')) return;
        const activePanelBtn = panelGrid.querySelector('.fs-ep-panel-btn.active');
        if (activePanelBtn) activePanelBtn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 50);

    // Update next-ep overlay title if there is a next episode
    const nextEpOverlay = document.getElementById('nextEpOverlay');
    nextEpOverlay.style.display = 'none'; // hide when switching episodes
    if (currentEpisodeIndex < totalEps - 1) {
        const nextEp = server.server_data[currentEpisodeIndex + 1];
        document.getElementById('nextEpTitle').textContent = nextEp.name || `Tập ${currentEpisodeIndex + 2}`;
    }
}

function openEpPanel() {
    document.getElementById('fsEpPanel').classList.add('open');
    // Scroll active episode into view after open animation
    setTimeout(() => {
        const active = document.querySelector('#fsEpPanelGrid .fs-ep-panel-btn.active');
        if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 350);
}

function closeEpPanel() {
    document.getElementById('fsEpPanel').classList.remove('open');
}

// Wire up episode navigation event listeners (called once on DOM ready)
// --- Custom HLS Player Controls & Keyboard Shortcuts ---
let isUserSeeking = false;

function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const pad = (num) => String(num).padStart(2, '0');
    if (hrs > 0) {
        return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
}

function updatePlayerSeekbar() {
    const video = document.getElementById('fsHlsVideoPlayer');
    if (!video || !video.duration || video.duration === Infinity) return;

    // Prevent browser audio pitch-shifting distortion ("rè rè ồm ồm" audio bug fix)
    if (video.preservesPitch !== false) {
        video.preservesPitch = false;
    }

    const currentTime = video.currentTime;
    const duration = video.duration;
    const percent = (currentTime / duration) * 100;

    // Auto save watch progress periodically while watching
    if (currentMovie && currentMovie.slug && currentTime > 5 && !video.paused) {
        saveLastActiveWatch(currentMovie.slug, currentServerIndex, currentEpisodeIndex, currentTime);
    }

    const seekbarInput = document.getElementById('fsSeekbarInput');
    const seekbarProgress = document.getElementById('fsSeekbarProgress');
    const currentTimeEl = document.getElementById('fsCurrentTime');
    const durationEl = document.getElementById('fsDuration');

    if (seekbarInput && !isUserSeeking) {
        seekbarInput.value = percent;
    }
    if (seekbarProgress) {
        seekbarProgress.style.width = `${percent}%`;
    }
    if (currentTimeEl) {
        currentTimeEl.textContent = formatTime(currentTime);
    }
    if (durationEl) {
        durationEl.textContent = formatTime(duration);
    }

    // Buffer progress
    if (video.buffered && video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const bufferPercent = (bufferedEnd / duration) * 100;
        const seekbarBuffer = document.getElementById('fsSeekbarBuffer');
        if (seekbarBuffer) seekbarBuffer.style.width = `${bufferPercent}%`;
    }
}

function updatePlayPauseBtnState() {
    const video = document.getElementById('fsHlsVideoPlayer');
    const btn = document.getElementById('fsPlayPauseBtn');
    if (!btn || !video) return;

    if (video.paused || video.ended) {
        btn.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
        btn.setAttribute('title', 'Phát (Space)');
    } else {
        btn.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
        btn.setAttribute('title', 'Tạm dừng (Space)');
    }
}

function updateVolumeUI() {
    const video = document.getElementById('fsHlsVideoPlayer');
    const btn = document.getElementById('fsVolumeBtn');
    const slider = document.getElementById('fsVolumeSlider');
    if (!video || !btn) return;

    if (slider) slider.value = video.muted ? 0 : video.volume;

    if (video.muted || video.volume === 0) {
        btn.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;
    } else if (video.volume < 0.5) {
        btn.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
    } else {
        btn.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
    }
}

// Wire up episode navigation & custom player event listeners (called once on DOM ready)
function initEpisodeNavListeners() {
    // Prev episode
    document.getElementById('fsPrevEpBtn').addEventListener('click', () => {
        if (currentEpisodeIndex > 0) playEpisode(currentServerIndex, currentEpisodeIndex - 1);
    });

    // Next episode
    document.getElementById('fsNextEpBtn').addEventListener('click', () => {
        const server = currentMovie && currentMovie.episodes[currentServerIndex];
        if (server && currentEpisodeIndex < server.server_data.length - 1) {
            playEpisode(currentServerIndex, currentEpisodeIndex + 1);
        }
    });

    // Next episode from overlay button
    document.getElementById('nextEpOverlayBtn').addEventListener('click', () => {
        const server = currentMovie && currentMovie.episodes[currentServerIndex];
        if (server && currentEpisodeIndex < server.server_data.length - 1) {
            document.getElementById('nextEpOverlay').style.display = 'none';
            playEpisode(currentServerIndex, currentEpisodeIndex + 1);
        }
    });

    // Episode list button (center of nav bar)
    document.getElementById('fsEpListBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        const panel = document.getElementById('fsEpPanel');
        panel.classList.contains('open') ? closeEpPanel() : openEpPanel();
    });

    // Episode panel close X
    document.getElementById('fsEpPanelClose').addEventListener('click', closeEpPanel);

    // HLS Video Events & Controls
    const video = document.getElementById('fsHlsVideoPlayer');
    const seekbarInput = document.getElementById('fsSeekbarInput');
    const playPauseBtn = document.getElementById('fsPlayPauseBtn');
    const rewind10Btn = document.getElementById('fsRewind10Btn');
    const forward10Btn = document.getElementById('fsForward10Btn');
    const volumeBtn = document.getElementById('fsVolumeBtn');
    const volumeSlider = document.getElementById('fsVolumeSlider');

    // Time update & video progress
    video.addEventListener('timeupdate', () => {
        updatePlayerSeekbar();
        updatePlayPauseBtnState();

        if (!video.duration || video.duration === Infinity) return;
        const server = currentMovie && currentMovie.episodes[currentServerIndex];
        if (!server) return;
        const hasNext = currentEpisodeIndex < server.server_data.length - 1;
        const overlay = document.getElementById('nextEpOverlay');
        const remaining = video.duration - video.currentTime;
        if (hasNext && remaining <= 30 && remaining > 0) {
            overlay.style.display = 'flex';
        } else {
            overlay.style.display = 'none';
        }
    });

    video.addEventListener('loadedmetadata', updatePlayerSeekbar);
    video.addEventListener('progress', updatePlayerSeekbar);
    video.addEventListener('play', updatePlayPauseBtnState);
    video.addEventListener('pause', updatePlayPauseBtnState);
    video.addEventListener('volumechange', updateVolumeUI);

    // Seekbar input dragging/clicking
    if (seekbarInput) {
        seekbarInput.addEventListener('input', (e) => {
            isUserSeeking = true;
            if (video && video.duration) {
                const seekToPercent = parseFloat(e.target.value);
                const targetTime = (seekToPercent / 100) * video.duration;
                document.getElementById('fsSeekbarProgress').style.width = `${seekToPercent}%`;
                document.getElementById('fsCurrentTime').textContent = formatTime(targetTime);
            }
        });

        seekbarInput.addEventListener('change', (e) => {
            if (video && video.duration) {
                const seekToPercent = parseFloat(e.target.value);
                video.currentTime = (seekToPercent / 100) * video.duration;
            }
            isUserSeeking = false;
        });
    }

    // Video container click (Click center of screen to Play/Pause)
    const fsHlsWrapper = document.getElementById('fsHlsWrapper');
    if (fsHlsWrapper) {
        fsHlsWrapper.addEventListener('click', (e) => {
            if (e.target.closest('.player-error') || e.target.closest('.next-ep-card')) return;
            togglePlayPause();
        });
    }

    // Play/Pause button click
    if (playPauseBtn) {
        playPauseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePlayPause();
        });
    }

    // Rewind 10s button click
    if (rewind10Btn) {
        rewind10Btn.addEventListener('click', () => {
            if (currentPlayerMode === 'hls') {
                if (video) video.currentTime = Math.max(0, video.currentTime - 10);
            } else {
                const fsEmbed = document.getElementById('fsEmbedPlayer');
                if (fsEmbed && fsEmbed.contentWindow) {
                    fsEmbed.focus();
                    try {
                        fsEmbed.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'seekBy', args: [-10] }), '*');
                        fsEmbed.contentWindow.postMessage({ action: 'seek', value: -10 }, '*');
                        fsEmbed.contentWindow.postMessage({ type: 'seek', seconds: -10 }, '*');
                    } catch (e) {}
                }
            }
        });
    }

    // Forward 10s button click
    if (forward10Btn) {
        forward10Btn.addEventListener('click', () => {
            if (currentPlayerMode === 'hls') {
                if (video && video.duration) video.currentTime = Math.min(video.duration, video.currentTime + 10);
            } else {
                const fsEmbed = document.getElementById('fsEmbedPlayer');
                if (fsEmbed && fsEmbed.contentWindow) {
                    fsEmbed.focus();
                    try {
                        fsEmbed.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'seekBy', args: [10] }), '*');
                        fsEmbed.contentWindow.postMessage({ action: 'seek', value: 10 }, '*');
                        fsEmbed.contentWindow.postMessage({ type: 'seek', seconds: 10 }, '*');
                    } catch (e) {}
                }
            }
        });
    }

    // Volume Mute toggle click
    if (volumeBtn) {
        volumeBtn.addEventListener('click', () => {
            video.muted = !video.muted;
            updateVolumeUI();
        });
    }

    // Volume Slider input
    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            video.volume = parseFloat(e.target.value);
            video.muted = (video.volume === 0);
            updateVolumeUI();
        });
    }

    // Global Keyboard Shortcuts when player is open
    document.addEventListener('keydown', (e) => {
        const fsPlayer = document.getElementById('fullscreenPlayer');
        if (!fsPlayer || fsPlayer.style.display !== 'flex') return;

        // Don't trigger shortcuts if focus is in text inputs
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

        const key = e.key.toLowerCase();

        // HLS controls
        if (currentPlayerMode === 'hls' && video) {
            if (key === ' ' || key === 'k') {
                e.preventDefault();
                togglePlayPause();
                showFsControls();
            } else if (key === 'arrowleft' || key === 'j') {
                e.preventDefault();
                video.currentTime = Math.max(0, video.currentTime - 10);
                showFsControls();
            } else if (key === 'arrowright' || key === 'l') {
                e.preventDefault();
                video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
                showFsControls();
            } else if (key === 'm') {
                e.preventDefault();
                video.muted = !video.muted;
                updateVolumeUI();
                showFsControls();
            } else if (key === 'arrowup') {
                e.preventDefault();
                video.volume = Math.min(1, video.volume + 0.1);
                video.muted = false;
                updateVolumeUI();
                showFsControls();
            } else if (key === 'arrowdown') {
                e.preventDefault();
                video.volume = Math.max(0, video.volume - 0.1);
                updateVolumeUI();
                showFsControls();
            }
        }

        // Global shortcuts (both modes)
        if (key === 'f') {
            e.preventDefault();
            document.getElementById('fsFullscreenBtn').click();
            showFsControls();
        } else if (key === 'n') {
            e.preventDefault();
            const server = currentMovie && currentMovie.episodes[currentServerIndex];
            if (server && currentEpisodeIndex < server.server_data.length - 1) {
                playEpisode(currentServerIndex, currentEpisodeIndex + 1);
            }
        } else if (key === 'p') {
            e.preventDefault();
            if (currentEpisodeIndex > 0) {
                playEpisode(currentServerIndex, currentEpisodeIndex - 1);
            }
        }
    });
}

// Load Video Stream Sources based on current mode
function loadVideoSource(embedUrl, m3u8Url) {
    const fsEmbed = document.getElementById('fsEmbedPlayer');
    const fsHlsWrapper = document.getElementById('fsHlsWrapper');
    const fsHlsVideo = document.getElementById('fsHlsVideoPlayer');
    const fsError = document.getElementById('fsPlayerError');
    const fsPipBtn = document.getElementById('fsPipBtn');
    const fsFullscreenBtn = document.getElementById('fsFullscreenBtn');

    // Cache URLs on elements to allow mode switching
    fsEmbed.setAttribute('data-src', embedUrl || '');
    fsHlsVideo.setAttribute('data-src', m3u8Url || '');

    stopVideoPlayer();

    // Reset default HLS error message
    fsError.innerHTML = `<i class="fas fa-exclamation-triangle"></i><p>Không thể phát HLS do chính sách bảo mật CORS từ nhà mạng/máy chủ nguồn. Hãy đổi sang "Server VIP (Nhúng)" trong phần Cài đặt góc dưới bên phải.</p>`;
    fsError.style.display = 'none';

    // Check if both stream URLs are completely empty/missing from the API
    if (!embedUrl && !m3u8Url) {
        fsEmbed.style.display = 'none';
        fsHlsWrapper.style.display = 'flex';
        fsError.style.display = 'flex';
        fsError.innerHTML = `<i class="fas fa-exclamation-triangle"></i><p>Rất tiếc, bộ phim này chưa có nguồn phát (Streaming Links). Vui lòng quay lại thử lại sau hoặc chọn phim khác.</p>`;
        fsPipBtn.style.display = 'none';
        fsFullscreenBtn.style.display = 'none';
        return;
    }

    const fsPlayerControls = document.getElementById('fsPlayerControls');

    if (currentPlayerMode === 'embed') {
        if (!embedUrl && m3u8Url) {
            // Auto-fallback: switch to HLS mode if Embed link is missing but HLS is available
            switchPlayerMode('hls');
            return;
        }
        
        fsEmbed.style.display = 'block';
        fsHlsWrapper.style.display = 'none';
        fsEmbed.src = embedUrl || '';
        fsPipBtn.style.display = 'none'; // Hidden in Embed mode as requested
        fsFullscreenBtn.style.display = 'none'; // Hidden in Embed mode as requested

        // Controls mode layout for Embed mode (floats above iframe controls)
        if (fsPlayerControls) {
            fsPlayerControls.classList.add('mode-embed');
            fsPlayerControls.classList.remove('mode-hls');
        }

        // Custom player controls visibility for Embed mode
        document.getElementById('fsSeekbarBar').style.display = 'none';
        document.getElementById('fsPlayPauseBtn').style.display = 'none';
        document.getElementById('fsRewind10Btn').style.display = 'flex';
        document.getElementById('fsForward10Btn').style.display = 'flex';
        document.getElementById('fsVolumeGroup').style.display = 'none';
    } else {
        fsEmbed.style.display = 'none';
        fsHlsWrapper.style.display = 'flex';
        fsPipBtn.style.display = 'block'; // Mini Player / Shrink button supported on HLS video
        fsFullscreenBtn.style.display = 'block'; // Fullscreen overlay button supported

        // Controls mode layout for HLS mode
        if (fsPlayerControls) {
            fsPlayerControls.classList.add('mode-hls');
            fsPlayerControls.classList.remove('mode-embed');
        }

        // Custom player controls visibility for HLS mode
        document.getElementById('fsSeekbarBar').style.display = 'flex';
        document.getElementById('fsPlayPauseBtn').style.display = 'flex';
        document.getElementById('fsRewind10Btn').style.display = 'flex';
        document.getElementById('fsForward10Btn').style.display = 'flex';
        document.getElementById('fsVolumeGroup').style.display = 'flex';
        
        if (!m3u8Url) {
            if (embedUrl) {
                // Auto-fallback: switch to Embed mode if HLS link is missing but Embed is available
                switchPlayerMode('embed');
            } else {
                fsError.style.display = 'flex';
            }
            return;
        }

        // Initialize Hls.js Player with CORS proxy support & audio pitch stability config
        if (Hls.isSupported()) {
            let isDirectFallbackAttempted = false;

            const setupHlsEvents = (instance, isDirect) => {
                instance.on(Hls.Events.MANIFEST_PARSED, () => {
                    fsHlsVideo.play().catch(e => console.log('HLS autoplay blocked by browser:', e));

                    // Auto resume saved seek position
                    if (pendingSeekTime !== null && pendingSeekTime > 5) {
                        const seekTo = pendingSeekTime;
                        pendingSeekTime = null;
                        setTimeout(() => {
                            if (fsHlsVideo.duration && seekTo < fsHlsVideo.duration) {
                                fsHlsVideo.currentTime = seekTo;
                                showResumeToast(seekTo);
                            }
                        }, 250);
                    }
                });

                instance.on(Hls.Events.ERROR, (event, data) => {
                    if (data.fatal) {
                        console.warn(`HLS Error (isDirect: ${isDirect}):`, data.type, data.details);
                        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                            instance.recoverMediaError();
                            return;
                        }

                        // Destroy broken instance
                        if (hlsPlayerInstance) {
                            hlsPlayerInstance.destroy();
                            hlsPlayerInstance = null;
                        }

                        if (!isDirect && !isDirectFallbackAttempted) {
                            isDirectFallbackAttempted = true;
                            console.log('Proxy failed, attempting direct HLS URL load:', m3u8Url);
                            hlsPlayerInstance = new Hls({
                                maxMaxBufferLength: 30,
                                maxBufferLength: 20,
                                enableWorker: true,
                                capLevelToPlayerSize: true,
                                maxAudioFramesDrift: 0
                            });
                            fsHlsVideo.preservesPitch = false;
                            fsHlsVideo.webkitPreservesPitch = false;
                            hlsPlayerInstance.loadSource(m3u8Url);
                            hlsPlayerInstance.attachMedia(fsHlsVideo);
                            setupHlsEvents(hlsPlayerInstance, true);
                        } else {
                            // Direct load also failed or no proxy fallback remaining
                            if (embedUrl) {
                                console.log('HLS failed, auto switching to Server VIP (Embed)...');
                                switchPlayerMode('embed');
                            } else {
                                fsError.style.display = 'flex';
                            }
                        }
                    }
                });
            };

            const proxiedM3u8Url = `/cors-proxy?url=${encodeURIComponent(m3u8Url)}`;
            hlsPlayerInstance = new Hls({
                maxMaxBufferLength: 30,
                maxBufferLength: 20,
                enableWorker: true,
                lowLatencyMode: false,
                capLevelToPlayerSize: true,
                stretchShortVideoTrack: true,
                maxBufferHole: 0.1,
                maxAudioFramesDrift: 0,
                forceKeyFrameOnDiscontinuity: true,
                highBufferWatchdogPeriod: 2
            });

            // Disable browser audio pitch distortion ("rè rè ồm ồm" audio bug fix)
            fsHlsVideo.preservesPitch = false;
            fsHlsVideo.webkitPreservesPitch = false;

            // Load via CORS proxy to bypass browser Same-Origin Policy & ISP blocking
            hlsPlayerInstance.loadSource(proxiedM3u8Url);
            hlsPlayerInstance.attachMedia(fsHlsVideo);
            setupHlsEvents(hlsPlayerInstance, false);
        } else if (fsHlsVideo.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari / Native support
            fsHlsVideo.src = m3u8Url;
            fsHlsVideo.addEventListener('loadedmetadata', () => {
                fsHlsVideo.play().catch(e => console.log('Native HLS autoplay blocked:', e));
                if (pendingSeekTime !== null && pendingSeekTime > 5) {
                    const seekTo = pendingSeekTime;
                    pendingSeekTime = null;
                    setTimeout(() => {
                        if (fsHlsVideo.duration && seekTo < fsHlsVideo.duration) {
                            fsHlsVideo.currentTime = seekTo;
                            showResumeToast(seekTo);
                        }
                    }, 250);
                }
            });
                }
            });
        } else {
            fsError.style.display = 'flex';
        }
    }
}

// Switch between Player Modes (embed vs HLS)
function switchPlayerMode(mode) {
    if (currentPlayerMode === mode) return;

    // Capture current playback timestamp before mode switch
    const video = document.getElementById('fsHlsVideoPlayer');
    let currentTimeToKeep = 0;
    if (video && video.currentTime > 5) {
        currentTimeToKeep = video.currentTime;
    } else if (currentMovie) {
        const saved = getSavedWatchProgress(currentMovie.slug);
        if (saved) currentTimeToKeep = saved.currentTime;
    }

    currentPlayerMode = mode;
    
    // Toggle active checkmarks in settings cog dropdown items
    document.getElementById('fsOptEmbed').classList.toggle('active', mode === 'embed');
    document.getElementById('fsOptHls').classList.toggle('active', mode === 'hls');

    const fsEmbed = document.getElementById('fsEmbedPlayer');
    const fsHlsVideo = document.getElementById('fsHlsVideoPlayer');
    
    const embedUrl = fsEmbed.getAttribute('data-src');
    const m3u8Url = fsHlsVideo.getAttribute('data-src');

    if (currentTimeToKeep > 5) {
        pendingSeekTime = currentTimeToKeep;
    }

    loadVideoSource(embedUrl, m3u8Url);
}

// Autohide Fullscreen Player Controls on Idle Mouse
function showFsControls() {
    const backBtn = document.getElementById('playerBackBtn');
    const fsPlayerControls = document.getElementById('fsPlayerControls');
    const fsSettingsMenu = document.getElementById('fsSettingsMenu');
    const fsPlayer = document.getElementById('fullscreenPlayer');

    if (fsPlayer.style.display !== 'flex') return;

    // Show controls & reset cursor on mouse move
    backBtn.classList.remove('hidden');
    fsPlayerControls.classList.remove('hidden');
    fsPlayer.style.cursor = 'default';

    // Autohide both back button AND controls bar together (synced with native player controls)
    clearTimeout(fsControlsTimeout);
    fsControlsTimeout = setTimeout(() => {
        if (fsPlayer.style.display === 'flex') {
            backBtn.classList.add('hidden');
            fsPlayerControls.classList.add('hidden');   // hide together with native controls
            fsSettingsMenu.classList.remove('open');     // close settings menu if open
            fsPlayer.style.cursor = 'none';              // hide cursor on idle
        }
    }, 3000);
}



// Stop Video playback and free memory
function stopVideoPlayer() {
    const fsEmbed = document.getElementById('fsEmbedPlayer');
    const fsHlsVideo = document.getElementById('fsHlsVideoPlayer');
    const fsError = document.getElementById('fsPlayerError');

    // Stop Embed iframe
    fsEmbed.src = '';

    // Stop Hls video
    fsHlsVideo.pause();
    fsHlsVideo.removeAttribute('src');
    fsHlsVideo.load();

    fsError.style.display = 'none';

    if (hlsPlayerInstance) {
        hlsPlayerInstance.destroy();
        hlsPlayerInstance = null;
    }
}

// Close Fullscreen Player and return to Movie Detail Modal
function closeFullscreenPlayer() {
    clearLastActiveWatch();

    const fsPlayer = document.getElementById('fullscreenPlayer');
    fsPlayer.style.display = 'none';
    fsPlayer.classList.remove('mini-player');
    const pipBtn = document.getElementById('fsPipBtn');
    if (pipBtn) pipBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    
    // Unlock page scroll if modal is closed, otherwise keep locked for modal view
    const modal = document.getElementById('detailModal');
    if (modal && modal.classList.contains('active')) {
        document.body.style.overflow = 'hidden';
    } else {
        document.body.style.overflow = '';
    } 
    fsPlayer.style.cursor = 'default';

    stopVideoPlayer();

    // Clear auto-hide timer
    clearTimeout(fsControlsTimeout);

    // Refresh active episode buttons in detail modal
    if (currentMovie) {
        renderEpisodesList(currentServerIndex);
    }
}

// Close Movie Detail Modal
function closeMovieDetail() {
    const modal = document.getElementById('detailModal');
    modal.classList.remove('active');
    
    // Unlock background page scroll
    document.body.style.overflow = ''; 

    // Stop and clear the trailer if playing
    const trailerIframe = document.getElementById('modalTrailerIframe');
    if (trailerIframe) trailerIframe.src = '';
    document.getElementById('modalTrailerSection').style.display = 'none';

    if (trailerObserver) {
        trailerObserver.disconnect();
        trailerObserver = null;
    }
    
    closeFullscreenPlayer();

    if (currentType === 'home') {
        syncHeroPreview();
    }
}
