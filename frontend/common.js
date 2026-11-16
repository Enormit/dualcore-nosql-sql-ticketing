window.PolyFlash = {
  get API() {
    return window.POLYFLASH_API.ENDPOINTS;
  },
  apiUrl(endpoint) {
    const base = (window.POLYFLASH_API && window.POLYFLASH_API.BASE_URL) || window.location.origin;
    return `${base}${endpoint}`;
  },
  getToken() {
    return localStorage.getItem('pf_token') || '';
  },
  getUser() {
    return (
      JSON.parse(localStorage.getItem('pf_user') || 'null') || {
        userId: 'user-demo-01',
        fullName: 'Nguyễn Văn An',
        email: 'user-demo-01@polyflash.vn',
        phone: '0901234567',
        address: 'Quận 1, TP. Hồ Chí Minh',
      }
    );
  },
  setAuth(token, user) {
    if (token) localStorage.setItem('pf_token', token);
    if (user) localStorage.setItem('pf_user', JSON.stringify(user));
  },
  logout() {
    localStorage.removeItem('pf_token');
    localStorage.removeItem('pf_user');
  },
  apiHeaders() {
    const h = { 'Content-Type': 'application/json' };
    const token = this.getToken();
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  },
  renderNavbar(activePage, showSearch = false) {
    const user = this.getUser();
    const token = this.getToken();
    const authLabel = token ? user.fullName || user.userId : 'Đăng nhập';

    const nav = document.getElementById('navbar-root');
    if (!nav) return;

    nav.innerHTML = `
      <nav class="navbar">
        <div class="navbar-inner">
          <a href="/index.html" class="brand">
            <span class="brand-dot"></span>
            <span>PolyFlash</span>
          </a>
          ${
            showSearch
              ? `<div class="search-bar"><input id="searchInput" type="text" placeholder="Tìm kiếm sự kiện, nghệ sĩ, địa điểm..." oninput="window.onSearchEvents && window.onSearchEvents(this.value)" /></div>`
              : ''
          }
          <div class="nav-links">
            <a href="/index.html" class="nav-btn ${activePage === 'lobby' ? 'active' : ''}" data-nav="lobby">Sự kiện</a>
            <a href="/tickets.html" class="nav-btn ${activePage === 'tickets' ? 'active' : ''}" data-nav="tickets">Vé của tôi</a>
            <a href="/admin.html" class="nav-btn ${activePage === 'admin' ? 'active' : ''}" data-nav="admin">Quản trị</a>
            <a href="/auth.html" class="nav-btn ${activePage === 'auth' ? 'active' : ''}" data-nav="auth">${authLabel}</a>
          </div>
        </div>
      </nav>
    `;
  },
};
