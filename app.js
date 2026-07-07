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

// Initialize on DOM Load
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

// App Entry Point
function initApp() {
    setupEventListeners();
    setupSliders();
    loadHomeData();
}

// Helper: Parse YouTube URL to Embed URL
function getYoutubeEmbedUrl(url, autoplay = 0) {
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
    
    if (videoId) {
        return `https://www.youtube.com/embed/${videoId}?autoplay=${autoplay}&mute=0&enablejsapi=1&rel=0`;
    }
    return null;
}

// Setup Event Listeners
function setupEventListeners() {
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
    const dropdownItems = document.querySelectorAll('.dropdown-item');
    dropdownItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const slug = item.getAttribute('data-slug');
            const name = item.getAttribute('data-name');
            selectGenre(slug, name, item);
        });
    });

    // Logo click resets to home
    document.getElementById('logoLink').addEventListener('click', (e) => {
        e.preventDefault();
        const homeLink = document.querySelector('.nav-link[data-type="home"]');
        switchTab('home', homeLink);
    });

    // Search Toggle & Input
    const searchBox = document.getElementById('searchBox');
    const searchBtn = document.getElementById('searchBtn');
    const searchInput = document.getElementById('searchInput');
    const searchClear = document.getElementById('searchClear');

    searchBtn.addEventListener('click', () => {
        searchBox.classList.add('expanded');
        searchInput.focus();
    });

    // Close search box if clicked outside and empty
    document.addEventListener('click', (e) => {
        if (!searchBox.contains(e.target) && searchInput.value.trim() === '') {
            searchBox.classList.remove('expanded');
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
        const icon = fsFullscreenBtn.querySelector('i');
        if (document.fullscreenElement) {
            icon.className = 'fas fa-compress';
        } else {
            icon.className = 'fas fa-expand';
        }
    });

    // Picture in Picture Toggle
    const fsPipBtn = document.getElementById('fsPipBtn');
    fsPipBtn.addEventListener('click', () => {
        const video = document.getElementById('fsHlsVideoPlayer');
        if (document.pictureInPictureElement) {
            document.exitPictureInPicture();
        } else if (video && video.readyState >= 1) {
            video.requestPictureInPicture().catch(e => console.error('PiP request failed:', e));
        }
    });

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

    // Inject skeletons for all rows
    const rows = ['new', 'single', 'action', 'series', 'horror', 'anime', 'scifi', 'historical', 'comedy', 'romance', 'adventure', 'crime'];
    rows.forEach(row => injectSkeletons(`track-${row}`, 8));

    // 1. Newly updated
    const resNew = await fetchApi(`${API_BASE}/danh-sach/phim-moi-cap-nhat?page=1`);
    if (resNew && resNew.items && resNew.items.length > 0) {
        renderHeroBanner(resNew.items[0]);
        renderTrack(resNew.items, 'track-new', getImageUrl, resNew.pathImage);
    }

    // 2. Single Movies
    const resSingle = await fetchApi(`${API_BASE}/v1/api/danh-sach/phim-le?page=1`);
    if (resSingle && resSingle.data) {
        const cdn = resSingle.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        renderTrack(resSingle.data.items, 'track-single', getImageUrl, cdn);
    }

    // 3. Action Movies (Genre)
    const resAction = await fetchApi(`${API_BASE}/v1/api/the-loai/hanh-dong?page=1`);
    if (resAction && resAction.data) {
        const cdn = resAction.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        renderTrack(resAction.data.items, 'track-action', getImageUrl, cdn);
    }

    // 4. TV Series
    const resSeries = await fetchApi(`${API_BASE}/v1/api/danh-sach/phim-bo?page=1`);
    if (resSeries && resSeries.data) {
        const cdn = resSeries.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        renderTrack(resSeries.data.items, 'track-series', getImageUrl, cdn);
    }

    // 5. Horror Movies (Genre)
    const resHorror = await fetchApi(`${API_BASE}/v1/api/the-loai/kinh-di?page=1`);
    if (resHorror && resHorror.data) {
        const cdn = resHorror.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        renderTrack(resHorror.data.items, 'track-horror', getImageUrl, cdn);
    }

    // 6. Anime
    const resAnime = await fetchApi(`${API_BASE}/v1/api/danh-sach/hoat-hinh?page=1`);
    if (resAnime && resAnime.data) {
        const cdn = resAnime.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        renderTrack(resAnime.data.items, 'track-anime', getImageUrl, cdn);
    }

    // 7. Sci-Fi Movies (Genre)
    const resSciFi = await fetchApi(`${API_BASE}/v1/api/the-loai/vien-tuong?page=1`);
    if (resSciFi && resSciFi.data) {
        const cdn = resSciFi.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        renderTrack(resSciFi.data.items, 'track-scifi', getImageUrl, cdn);
    }

    // 8. Historical / Costume Movies (Genre)
    const resHist = await fetchApi(`${API_BASE}/v1/api/the-loai/co-trang?page=1`);
    if (resHist && resHist.data) {
        const cdn = resHist.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        renderTrack(resHist.data.items, 'track-historical', getImageUrl, cdn);
    }

    // 9. Comedy Movies (Genre: hai-huoc)
    const resComedy = await fetchApi(`${API_BASE}/v1/api/the-loai/hai-huoc?page=1`);
    if (resComedy && resComedy.data) {
        const cdn = resComedy.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        renderTrack(resComedy.data.items, 'track-comedy', getImageUrl, cdn);
    }

    // 10. Romance Movies (Genre: tinh-cam)
    const resRomance = await fetchApi(`${API_BASE}/v1/api/the-loai/tinh-cam?page=1`);
    if (resRomance && resRomance.data) {
        const cdn = resRomance.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        renderTrack(resRomance.data.items, 'track-romance', getImageUrl, cdn);
    }

    // 11. Adventure Movies (Genre: phieu-luu)
    const resAdventure = await fetchApi(`${API_BASE}/v1/api/the-loai/phieu-luu?page=1`);
    if (resAdventure && resAdventure.data) {
        const cdn = resAdventure.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        renderTrack(resAdventure.data.items, 'track-adventure', getImageUrl, cdn);
    }

    // 12. Crime Movies (Genre: hinh-su)
    const resCrime = await fetchApi(`${API_BASE}/v1/api/the-loai/hinh-su?page=1`);
    if (resCrime && resCrime.data) {
        const cdn = resCrime.data.APP_DOMAIN_CDN_IMAGE + '/uploads/movies/';
        renderTrack(resCrime.data.items, 'track-crime', getImageUrl, cdn);
    }
}

// Render Featured Hero Banner
async function renderHeroBanner(movie) {
    if (!movie) return;

    // Add to displayed slugs so it doesn't appear in rows
    displayedSlugs.add(movie.slug);

    // Fetch movie detail to get backdrop poster and full description
    const resDetail = await fetchApi(`${API_BASE}/phim/${movie.slug}`);
    if (!resDetail || !resDetail.movie) return;

    const fullMovie = resDetail.movie;

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

    // Bind action buttons
    const playBtn = document.getElementById('heroPlayBtn');
    const infoBtn = document.getElementById('heroInfoBtn');

    // Remove old listeners
    const newPlayBtn = playBtn.cloneNode(true);
    const newInfoBtn = infoBtn.cloneNode(true);
    playBtn.parentNode.replaceChild(newPlayBtn, playBtn);
    infoBtn.parentNode.replaceChild(newInfoBtn, infoBtn);

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

        html += `
            <div class="movie-card" data-slug="${movie.slug}">
                <img src="${imageUrl}" alt="${movie.name}" class="movie-card-img" loading="lazy">
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

    track.innerHTML = html;

    // Attach Click Events to Cards
    const cards = track.querySelectorAll('.movie-card');
    cards.forEach(card => {
        card.addEventListener('click', () => {
            const slug = card.getAttribute('data-slug');
            openMovieDetail(slug);
        });
    });
}

// Load Categorized Lists with Pagination
async function loadCategoryPage(type, page) {
    const grid = document.getElementById('categoryGrid');
    injectSkeletons('categoryGrid', 12);
    
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

        html += `
            <div class="movie-card" data-slug="${movie.slug}">
                <img src="${imageUrl}" alt="${movie.name}" class="movie-card-img" loading="lazy">
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
        } else {
            categorySection.style.display = 'block';
        }
        return;
    }

    // Enter Search Mode UI
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
async function openMovieDetail(slug, autoPlay = false) {
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
        const embedUrl = getYoutubeEmbedUrl(currentMovie.trailer_url, 0); // autoplay = 0
        if (embedUrl) {
            document.getElementById('modalTrailerSection').style.display = 'block';
            document.getElementById('modalTrailerIframe').src = embedUrl;
        }
    }

    // Episodes & Servers Section
    setupEpisodesAndServers(autoPlay);

    // Bind "Xem Ngay" button to play first episode
    const playBtn = document.getElementById('modalPlayBtn');
    const newPlayBtn = playBtn.cloneNode(true);
    playBtn.parentNode.replaceChild(newPlayBtn, playBtn);
    
    newPlayBtn.addEventListener('click', () => {
        playEpisode(0, 0);
    });
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

// Play Selected Episode in Fullscreen Theater Mode
function playEpisode(serverIndex, episodeIndex) {
    currentServerIndex = serverIndex;
    currentEpisodeIndex = episodeIndex;

    const server = currentMovie.episodes[serverIndex];
    if (!server || !server.server_data) return;
    
    const ep = server.server_data[episodeIndex];
    if (!ep) return;

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

    // Load Stream Source in fullscreen player
    loadVideoSource(ep.link_embed, ep.link_m3u8);
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

    if (currentPlayerMode === 'embed') {
        fsEmbed.style.display = 'block';
        fsHlsWrapper.style.display = 'none';
        fsEmbed.src = embedUrl;
        fsPipBtn.style.display = 'none'; // PiP not supported on iframe
        fsFullscreenBtn.style.display = 'none'; // Fullscreen overlay button supported
    } else {
        fsEmbed.style.display = 'none';
        fsHlsWrapper.style.display = 'flex';
        fsPipBtn.style.display = 'block'; // PiP supported on HLS video
        fsFullscreenBtn.style.display = 'block'; // Fullscreen overlay button supported
        
        if (!m3u8Url) {
            fsError.style.display = 'flex';
            return;
        }

        // Initialize Hls.js Player
        if (Hls.isSupported()) {
            hlsPlayerInstance = new Hls({
                maxMaxBufferLength: 30,
                enableWorker: true
            });
            hlsPlayerInstance.loadSource(m3u8Url);
            hlsPlayerInstance.attachMedia(fsHlsVideo);
            hlsPlayerInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                fsHlsVideo.play().catch(e => console.log('HLS autoplay blocked by browser:', e));
            });
            hlsPlayerInstance.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    console.error('Fatal HLS Error:', data);
                    fsError.style.display = 'flex';
                    hlsPlayerInstance.destroy();
                    hlsPlayerInstance = null;
                }
            });
        } else if (fsHlsVideo.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari / Native support
            fsHlsVideo.src = m3u8Url;
            fsHlsVideo.addEventListener('loadedmetadata', () => {
                fsHlsVideo.play().catch(e => console.log('Native HLS autoplay blocked:', e));
            });
        } else {
            fsError.style.display = 'flex';
        }
    }
}

// Switch between Player Modes (embed vs HLS)
function switchPlayerMode(mode) {
    if (currentPlayerMode === mode) return;

    currentPlayerMode = mode;
    
    // Toggle active checkmarks in settings cog dropdown items
    document.getElementById('fsOptEmbed').classList.toggle('active', mode === 'embed');
    document.getElementById('fsOptHls').classList.toggle('active', mode === 'hls');

    const fsEmbed = document.getElementById('fsEmbedPlayer');
    const fsHlsVideo = document.getElementById('fsHlsVideoPlayer');
    
    const embedUrl = fsEmbed.getAttribute('data-src');
    const m3u8Url = fsHlsVideo.getAttribute('data-src');

    loadVideoSource(embedUrl, m3u8Url);
}

// Autohide Fullscreen Player Controls on Idle Mouse
function showFsControls() {
    const backBtn = document.getElementById('playerBackBtn');
    const fsPlayerControls = document.getElementById('fsPlayerControls');
    const fsSettingsMenu = document.getElementById('fsSettingsMenu');
    const fsPlayer = document.getElementById('fullscreenPlayer');

    if (fsPlayer.style.display !== 'flex') return;

    // Show elements & reset cursor
    backBtn.classList.remove('hidden');
    fsPlayerControls.classList.remove('hidden');
    fsPlayer.style.cursor = 'default';

    // Clear previous timer and set new one
    clearTimeout(fsControlsTimeout);
    fsControlsTimeout = setTimeout(() => {
        if (fsPlayer.style.display === 'flex') {
            backBtn.classList.add('hidden');
            fsPlayerControls.classList.add('hidden');
            fsSettingsMenu.classList.remove('open'); // close settings menu if open
            fsPlayer.style.cursor = 'none'; // hide cursor on idle
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
    const fsPlayer = document.getElementById('fullscreenPlayer');
    fsPlayer.style.display = 'none';
    
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
    
    closeFullscreenPlayer();
}
