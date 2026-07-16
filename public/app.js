

// ========== BIN Manager v2 — Frontend App ==========
const isDev = window.location.hostname.includes('bin-manager-dev') ||
    window.location.hostname.includes('localhost') ||
    window.location.hostname.includes('127.0.0.1') ||
    window.location.port === '3001';
if (isDev) document.body.classList.add('is-dev');
document.title = isDev ? 'Dev Bin Manager' : 'Bin Manager';

let token = null;
let currentUser = null;
let currentSort = { column: 'bin_number', order: 'asc' };
let binsData = [];
let currentPage = 1;
const PAGE_SIZE = 50;
let colVisibility = {};
// Multi-select filter state: key -> Set of selected values
let activeFilters = {};
const FILTER_LABELS = {
    country: 'País', status: 'Estado', brand: 'Marca', bin_length: 'Dígitos',
    segment: 'Segmento', product: 'Producto', bin_type: 'Tipo BIN',
    product: 'Producto', segment: 'Segmento', client: 'Cliente', 
    billeteras: 'Billeteras', balance_type: 'Tipo Saldos', bin_tokenizado: 'BIN Tokenizado'
};
const STATUS_LABELS = {
    available: 'Disponible', segmented: 'Segmentado', assigned: 'Asignado',
    pending: 'Por aprobar', exhausted: 'Agotado', on_hold: 'En Espera'
};
const BINS_COL_CONFIG = [
    { key: 'country',      label: 'País',          cls: 'col-country',      defaultVis: true  },
    { key: 'ica',          label: 'ICA',            cls: 'col-ica',          defaultVis: true  },
    { key: 'ica_qmr',      label: 'ICA QMR',        cls: 'col-ica-qmr',     defaultVis: false },
    { key: 'bin_number',   label: 'BIN',            cls: 'col-bin',          defaultVis: true  },
    { key: 'bin_length',   label: 'Dígitos',        cls: 'col-digits',       defaultVis: true  },
    { key: 'brand',        label: 'Marca',          cls: 'col-brand',        defaultVis: true  },
    { key: 'product',      label: 'Producto',       cls: 'col-product',      defaultVis: true  },
    { key: 'segment',      label: 'Segmento',       cls: 'col-segment',      defaultVis: true  },
    { key: 'status',       label: 'Estado',         cls: 'col-status',       defaultVis: true  },
    { key: 'client',       label: 'Cliente',        cls: 'col-client',       defaultVis: true  },
    { key: 'bin_tokenizado', label: 'BIN Tokenizado',  cls: 'col-bin-tok',   defaultVis: false },
    { key: 'billeteras', label: 'Billeteras',   cls: 'col-billeteras', defaultVis: false },
    { key: 'bin_type',     label: 'Tipo de BIN',    cls: 'col-bin-type',     defaultVis: true  },
    { key: 'embosser',     label: 'Embozador',      cls: 'col-embosser',     defaultVis: true  },
    { key: 'balance_type', label: 'Tipo de Saldos', cls: 'col-balance',      defaultVis: false },
];

const PRODUCT_SEGMENTS = {
    'Crédito': ['Standard', 'Gold', 'Platinum', 'World', 'World Elite', 'Black', 'Titanium', 'Business', 'Corporate', 'Professional', 'Executive'],
    'Débito': ['Debit (Standard)', 'Gold Debit', 'Platinum Debit', 'World Debit', 'World Elite Debit', 'Business Debit', 'Professional Debit'],
    'Prepago': ['Consumer Prepaid', 'Small Business Prepaid', 'Government', 'Payroll', 'Voucher']
};

// ========== API Helper ==========
async function api(url, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
    if (res.status === 401 || res.status === 403) {
        token = null; currentUser = null;
        localStorage.removeItem('binManagerToken');
        showLogin();
        throw new Error('Sesión expirada');
    }
    return res;
}

// ========== Toast ==========
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

// ========== Modal ==========
function openModal(id) { 
    const el = document.getElementById(id);
    if (el) {
        el.classList.add('active'); 
        el.classList.remove('hidden');
    }
}
function closeModal(id) { 
    const el = document.getElementById(id);
    if (el) {
        el.classList.remove('active'); 
        el.classList.add('hidden');
    }
}

function safeAddListener(id, event, callback) {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener(event, callback);
    }
}

// ========== Status Badge ==========
function statusBadge(status) {
    if (status === 'assigned') return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>Asignado</span>`;
    if (status === 'available') return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700"><span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>Disponible</span>`;
    if (status === 'on_hold') return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700"><span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>En Espera</span>`;
    if (status === 'segmented') return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-50 text-purple-700"><span class="w-1.5 h-1.5 rounded-full bg-purple-500"></span>Segmentado</span>`;
    if (status === 'exhausted') return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-content-secondary"><span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>Agotado</span>`;
    return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-content-secondary">${status}</span>`;
}

function getSaaSTokenBadge(val) {
    if (val === 'Sí') return `<span class="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">Sí</span>`;
    if (val === 'No') return `<span class="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-content-secondary">No</span>`;
    return `<span class="text-content-muted">—</span>`;
}

function getSaaSSegmentBadge(seg) {
    if (!seg) return `<span class="text-content-muted">—</span>`;
    if (seg.toLowerCase() === 'black') return `<span class="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-100">Black</span>`;
    return `<span class="text-content-secondary">${seg}</span>`;
}

// Helper: Banderas
const getFlag = (countryName) => {
    const c = (countryName || '').toLowerCase();
    let code = '';
    if (c.includes('costa rica')) code = 'cr';
    else if (c.includes('guatemala')) code = 'gt';
    else if (c.includes('el salvador')) code = 'sv';
    else if (c.includes('honduras')) code = 'hn';
    else if (c.includes('nicaragua')) code = 'ni';
    else if (c.includes('panam')) code = 'pa';
    else if (c.includes('dominicana')) code = 'do';
    else if (c.includes('colombia')) code = 'co';
    else if (c.includes('peru') || c.includes('perú')) code = 'pe';
    else if (c.includes('mexico') || c.includes('méxico')) code = 'mx';
    
    if (code) return `<img src="https://flagcdn.com/w20/${code}.png" alt="${countryName}" class="w-5 h-auto rounded-sm shadow-sm">`;
    return '🌎';
};

// Helper to get status badge HTML
const getStatusBadge = (status) => {
    switch(status?.toLowerCase()) {
        case 'assigned': return '<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-status-success-bg text-status-success-txt border-transparent shadow-none">Assigned</span>';
        case 'available': return '<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-status-info-bg text-status-info-txt border-transparent shadow-none">Available</span>';
        case 'on_hold': return '<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-status-warn-bg text-status-warn-txt border-transparent shadow-none">On Hold</span>';
        case 'segmented': return '<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-status-danger-bg text-status-danger-txt border-transparent shadow-none">Segmented</span>';
        default: return `<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-content-secondary dark:bg-canvas0/10 dark:text-slate-300 dark:border-slate-700">${status}</span>`;
    }
};

// Helper: Product Pill
const getProductBadge = (product) => {
    const p = (product || '').toLowerCase();
    if (p.includes('prepago')) return '<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-status-info-bg text-status-info-txt border-transparent">Prepago</span>';
    if (p.includes('crédito') || p.includes('credito')) return '<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-status-neutral-bg text-status-neutral-txt border-transparent">Crédito</span>';
    if (p.includes('débito') || p.includes('debito')) return '<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-status-success-bg text-status-success-txt border-transparent">Débito</span>';
    return `<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-canvas text-content-secondary dark:bg-canvas0/10 dark:text-content-muted border border-divider">${product || 'N/A'}</span>`;
};

// Helper: Embosser Avatar
const getEmbosserAvatar = (name) => {
    if (!name || name === 'Sin Embozador') return `<div class="w-8 h-8 rounded-md bg-slate-100 text-content-muted dark:bg-slate-800/50 dark:text-content-muted flex items-center justify-center font-bold text-xs">?</div>`;
    const initial = name.charAt(0).toUpperCase();
    const colors = ['bg-orange-100 text-orange-700', 'bg-teal-100 text-teal-700', 'bg-indigo-100 text-indigo-700', 'bg-rose-100 text-rose-700', 'bg-blue-100 text-blue-700'];
    const colorClass = colors[name.charCodeAt(0) % colors.length];
    return `<div class="w-8 h-8 rounded-md ${colorClass} flex items-center justify-center font-bold text-sm shadow-sm">${initial}</div>`;
};

function requestStatusBadge(status) {
    const map = {
        pending: { label: 'Pendiente', cls: 'badge-pending' },
        approved: { label: 'Aprobada', cls: 'badge-success' },
        rejected: { label: 'Rechazada', cls: 'badge-danger' }
    };
    const s = map[status] || { label: status, cls: '' };
    return `<span class="badge ${s.cls}">${s.label}</span>`;
}

// ========== Auth ==========
function showLogin() {
    document.getElementById('loginPage').classList.remove('hidden');
    document.getElementById('appPage').classList.add('hidden');
}

// ========== Multi-Select Dropdown System ==========
function initMultiselectDropdown(el, options) {
    const filterKey = el.dataset.filter;
    const label = el.dataset.label || filterKey;
    if (!activeFilters[filterKey]) activeFilters[filterKey] = new Set();

    el.innerHTML = `
        <div class="ms-trigger" data-filter="${filterKey}">
            <span class="ms-label">Todos</span>
            <span class="ms-arrow">▾</span>
        </div>
        <div class="ms-dropdown hidden">
            <div class="ms-clear hidden" data-filter="${filterKey}">✕ Limpiar</div>
            <div class="ms-options-container">
                ${options.map(o => `
                    <label class="ms-option flex items-center gap-3 cursor-pointer hover:bg-surface-hover p-2 rounded-lg">
                        <input type="checkbox" class="custom-checkbox" value="${o.value}" data-filter="${filterKey}">
                        <span class="text-sm font-medium text-content-secondary">${o.label}</span>
                    </label>`).join('')}
            </div>
        </div>`;

    const trigger = el.querySelector('.ms-trigger');
    const dropdown = el.querySelector('.ms-dropdown');
    const labelEl = el.querySelector('.ms-label');
    const clearBtn = el.querySelector('.ms-clear');
    const checkboxes = el.querySelectorAll('input[type=checkbox]');

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasOpen = el.classList.contains('ms-open');
        closeAllMultiselects(el);
        if (!wasOpen) {
            dropdown.classList.remove('hidden');
            el.classList.add('ms-open');
        } else {
            dropdown.classList.add('hidden');
            el.classList.remove('ms-open');
        }
    });

    clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        activeFilters[filterKey].clear();
        updateLabel();
        loadBins();
        updateFilterSummary();
    });

    checkboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            if (cb.checked) activeFilters[filterKey].add(cb.value);
            else activeFilters[filterKey].delete(cb.value);
            updateLabel();
            loadBins();
            updateFilterSummary();
        });
    });

    dropdown.addEventListener('click', (e) => {
        e.stopPropagation(); // Evita que se cierre al hacer clic dentro
    });

    function updateLabel() {
        const sel = activeFilters[filterKey];
        const btnLabel = sel.size === 0 ? 'Todos' : Array.from(sel).map(v => {
            const opt = options.find(o => String(o.value) === String(v));
            return opt ? opt.label : v;
        }).join(', ');
        labelEl.textContent = btnLabel;
        
        if (sel.size > 0) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');

        checkboxes.forEach(cb => {
            cb.checked = sel.has(cb.value);
        });
    }

    el._renderMs = updateLabel;
    updateLabel();
}

function closeAllMultiselects(except) {
    document.querySelectorAll('.multiselect-dropdown').forEach(el => {
        if (el !== except) {
            el.querySelectorAll('.ms-dropdown').forEach(d => d.classList.add('hidden'));
            el.classList.remove('ms-open');
        }
    });
}

// ========== Filters Init ==========
async function initFilters() {
    try {
        const res = await api('/api/bins/filter-options');
        if (!res.ok) return;
        const data = await res.json();

        const dynamicMap = {
            msCountry:     data.countries.map(v => ({ value: v, label: v })),
            msIca:         data.icas.map(v => ({ value: v, label: v })),
            msClient:      data.clients.map(v => ({ value: v, label: v })),
            msBrand:       data.brands.map(v => ({ value: v, label: v })),
            msProduct:     data.products.map(v => ({ value: v, label: v })),
            msSegment:     data.segments.map(v => ({ value: v, label: v })),
            msProcessor:   data.billeteras.map(v => ({ value: v, label: v })),
            msEmbosser:    data.embossers.map(v => ({ value: v, label: v })),
            msBalanceType: data.balanceTypes.map(v => ({ value: v, label: v })),
            msBinType:     data.binTypes.map(v => ({ value: v, label: v }))
        };

        document.querySelectorAll('.multiselect-dropdown').forEach(el => {
            let options = [];
            if (el.dataset.static) {
                options = el.dataset.static.split(',').map(pair => {
                    const [value, label] = pair.split(':');
                    return { value, label };
                });
            } else if (dynamicMap[el.id]) {
                options = dynamicMap[el.id];
            }
            initMultiselectDropdown(el, options);
        });
    } catch(e) {
        console.error('Error loading filter options:', e);
    }
}

function showApp() {
    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('appPage').classList.remove('hidden');

    initFilters();

    if (currentUser) {
        document.getElementById('userName').textContent = currentUser.full_name || currentUser.username;
        const roleLabels = { admin: 'Administrador', viewer: 'Solo Lectura', requester: 'Solicitante' };
        document.getElementById('userRole').textContent = roleLabels[currentUser.role] || currentUser.role;
        document.getElementById('userAvatar').textContent = (currentUser.full_name || currentUser.username).charAt(0).toUpperCase();
    }

    // Show/hide elements by role
    const isAdmin = currentUser && currentUser.role === 'admin';
    const isRequester = currentUser && (currentUser.role === 'requester' || currentUser.role === 'admin');

    document.querySelectorAll('[data-role="admin"]').forEach(el => {
        if (isAdmin) {
            el.style.display = '';
            el.classList.remove('inline-style-1', 'hidden');
        } else {
            el.style.display = 'none';
        }
    });
    document.querySelectorAll('[data-role="requester"]').forEach(el => {
        if (isRequester) {
            el.style.display = '';
            el.classList.remove('inline-style-1', 'hidden');
        } else {
            el.style.display = 'none';
        }
    });

    // Hide 8-digit option for non-admins in request form
    const opt8 = document.getElementById('reqDigits8');
    if (opt8) {
        if (isAdmin) {
            opt8.style.display = '';
            opt8.classList.remove('inline-style-1', 'hidden');
        } else {
            opt8.style.display = 'none';
        }
    }

    // Non-admins cannot manually choose digits — always locked, auto-set by product
    const reqDigitsSel = document.getElementById('reqDigits');
    if (reqDigitsSel && !isAdmin) reqDigitsSel.disabled = true;

    initColVisibility();
    loadCountries();
    loadEmbossers();
    seedLatamCountries();
    navigateTo('dashboard');
}

// ========== Countries ==========
async function loadCountries() {
    try {
        const res = await api('/api/countries');
        const countries = await res.json();
        // Populate all country selects
        ['binCountry', 'reqCountry'].forEach(selectId => {
            const sel = document.getElementById(selectId);
            if (!sel) return;
            const current = sel.value;
            sel.innerHTML = '<option value="">Seleccionar...</option>';
            countries.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.name;
                opt.textContent = c.name;
                sel.appendChild(opt);
            });
            if (current) sel.value = current;
        });
    } catch (e) { console.error('Load countries error:', e); }
}

// Seed all missing LATAM countries into the DB (silent, admin only)
async function seedLatamCountries() {
    const isAdmin = currentUser && currentUser.role === 'admin';
    if (!isAdmin) return;
    const latam = [
        'Argentina','Bolivia','Brasil','Chile','Colombia','Costa Rica',
        'Cuba','Ecuador','El Salvador','Guatemala','Haití','Honduras',
        'Jamaica','México','Nicaragua','Panamá','Paraguay','Perú',
        'República Dominicana','Trinidad y Tobago','Uruguay','Venezuela'
    ];
    try {
        const res = await api('/api/countries');
        const existing = await res.json();
        const existingNames = new Set(existing.map(c => c.name));
        for (const name of latam) {
            if (!existingNames.has(name)) {
                // POST silently; 409 = already exists, that's fine
                await api('/api/countries', { method: 'POST', body: JSON.stringify({ name }) });
            }
        }
        // Refresh selects after seeding
        await loadCountries();
    } catch (e) { /* ignore seed errors */ }
}

// ========== Embossers ==========
async function loadEmbossers() {
    try {
        const res = await api('/api/embossers');
        const embossers = await res.json();
        ['binEmbosser', 'reqEmbosser', 'filterEmbosser', 'segEmbosser'].forEach(selectId => {
            const sel = document.getElementById(selectId);
            if (!sel) return;
            const current = sel.value;
            // Keep first option (Seleccionar... or Embozador...)
            const firstOpt = sel.options[0];
            sel.innerHTML = '';
            sel.appendChild(firstOpt);
            embossers.forEach(e => {
                const opt = document.createElement('option');
                opt.value = e.name;
                opt.textContent = e.name;
                sel.appendChild(opt);
            });
            if (current) sel.value = current;
        });
    } catch (e) { console.error('Load embossers error:', e); }
}

async function addEmbosser(targetSelectId) {
    const name = prompt('Nombre del nuevo embozador:');
    if (!name || !name.trim()) return;
    try {
        const res = await api('/api/embossers', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
        showToast(`Embozador "${name.trim()}" agregado`);
        await loadEmbossers();
        if (targetSelectId) document.getElementById(targetSelectId).value = name.trim();
    } catch (e) { showToast(e.message, 'error'); }
}

async function addCountry(targetSelectId) {
    const name = prompt('Nombre del nuevo país:');
    if (!name || !name.trim()) return;
    try {
        const res = await api('/api/countries', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
        showToast(`País "${name.trim()}" agregado`);
        await loadCountries();
        // Auto-select the new country in the target select
        const sel = document.getElementById(targetSelectId || 'binCountry');
        if (sel) sel.value = name.trim();
    } catch (e) { showToast(e.message, 'error'); }
}

// ========== Navigation ==========
function navigateTo(page) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(p => {
        if (!p.hasAttribute('data-role')) {
            p.classList.add('hidden');
        } else {
            p.classList.add('hidden');
        }
    });

    // Show target page
    const target = document.getElementById('page' + page.charAt(0).toUpperCase() + page.slice(1));
    if (target) target.classList.remove('hidden');

    // Update nav active
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (nav) nav.classList.add('active');

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');

    // Load page data
    if (page === 'dashboard') loadDashboard();
    else if (page === 'bins') loadBins();
    else if (page === 'users') loadUsers();
    else if (page === 'approvals') loadApprovals();
    else if (page === 'myRequests') loadMyRequests();
    else if (page === 'audit') loadAudit();
}

async function loadDashboard() {
    try {
        // Initialize dynamic dropdowns once
        if (!window.dashboardOptionsLoaded) {
            const rawRes = await api('/api/bins');
            const allBins = await rawRes.json();
            
            const countries = [...new Set(allBins.map(b => b.country).filter(Boolean))].sort();
            const embossers = [...new Set(allBins.map(b => b.embosser).filter(Boolean))].sort();
            const parents = [...new Set(allBins.filter(b => b.bin_length === 8).map(b => b.bin_number))].sort();
            const lengths = [...new Set(allBins.map(b => parseInt(b.bin_length)).filter(l => !isNaN(l)))].sort((a,b) => a - b);

            const lSelect = document.getElementById('dashFilterLength');
            lengths.forEach(l => lSelect.innerHTML += `<option value="${l}">${l} dígitos</option>`);

            const cSelect = document.getElementById('dashFilterCountry');
            countries.forEach(c => cSelect.innerHTML += `<option value="${c}">${c}</option>`);
            
            const eSelect = document.getElementById('dashFilterEmbosser');
            embossers.forEach(e => eSelect.innerHTML += `<option value="${e}">${e}</option>`);

            const pDatalist = document.getElementById('parentBinsDatalist');
            parents.forEach(p => pDatalist.innerHTML += `<option value="${p}">`);
            
            // Add listeners for advanced filters
            const advFilters = ['dashFilterLength', 'dashFilterCountry', 'dashFilterEmbosser', 'dashFilterTokenizado', 'dashFilterParentBin'];
            advFilters.forEach(id => {
                document.getElementById(id).addEventListener('change', loadDashboard);
            });
            
            // Toggle filters panel
            const toggleBtn = document.getElementById('dashToggleFiltersBtn');
            const filtersPanel = document.getElementById('dashboardAdvancedFilters');
            if (toggleBtn && filtersPanel) {
                toggleBtn.addEventListener('click', () => {
                    filtersPanel.classList.toggle('hidden');
                    filtersPanel.classList.toggle('flex');
                });
            }

            // Clear filters button
            const clearBtn = document.getElementById('dashClearFiltersBtn');
            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    advFilters.forEach(id => {
                        document.getElementById(id).value = '';
                    });
                    const statuses = ['assigned', 'available', 'on_hold', 'segmented'];
                    statuses.forEach(s => {
                        const cb = document.querySelector(`#dashboardFilters input[value="${s}"]`);
                        if (cb) cb.checked = true;
                    });
                    loadDashboard();
                });
            }
            
            window.dashboardOptionsLoaded = true;
        }

        // Build query string for API
        const params = new URLSearchParams();
        const len = document.getElementById('dashFilterLength')?.value;
        const country = document.getElementById('dashFilterCountry')?.value;
        const emb = document.getElementById('dashFilterEmbosser')?.value;
        const tok = document.getElementById('dashFilterTokenizado')?.value;
        const par = document.getElementById('dashFilterParentBin')?.value;
        
        if (len) params.set('bin_length', len);
        if (country) params.set('country', country);
        if (emb) params.set('embosser', emb);
        if (tok) params.set('bin_tokenizado', tok);
        if (par) params.set('parent_bin', par);

        const qs = params.toString();
        const res = await api(`/api/bins/stats${qs ? '?' + qs : ''}`);
        const { kpis, pivotProducto, pivotToken, tableIcas, distribData, tableEmbozadores } = await res.json();
        
        window.dashboardData = { kpis, pivotProducto, distribData, tableIcas, tableEmbozadores };
        
        // Setup status filter listeners once
        if (!window.dashboardFiltersBound) {
            document.querySelectorAll('#dashboardFilters input[type="checkbox"]').forEach(cb => {
                cb.addEventListener('change', renderFilteredDashboard);
            });
            window.dashboardFiltersBound = true;
        }

        // Configuración global de Chart.js
        Chart.defaults.font.family = "'Inter', sans-serif";
        Chart.defaults.color = '#64748B';
        Chart.defaults.scale.grid.color = '#F1F5F9';

        window.statusColors = {
            assigned: '#10B981',
            available: '#3B82F6',
            on_hold: '#F59E0B',
            segmented: '#EF4444'
        };

        window.productColors = {
            credito: '#8B5CF6',
            debito: '#F59E0B',
            prepago: '#3B82F6'
        };

        // Render everything based on initial/current filters
        renderFilteredDashboard();
        
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        showToast('Error cargando métricas: ' + error.message, 'error');
    }
}

function renderFilteredDashboard() {
    const { kpis, pivotProducto, distribData, tableIcas, tableEmbozadores } = window.dashboardData || {};
    const selectedStatuses = Array.from(document.querySelectorAll('#dashboardFilters input[type="checkbox"]:checked')).map(cb => cb.value);

    // Filter tabular data
    const filteredIcas = (tableIcas || []).filter(i => selectedStatuses.includes(i.status));
    const filteredDistrib = (distribData || []).filter(d => selectedStatuses.includes(d.status));
    const filteredEmbozadores = (tableEmbozadores || []).filter(e => selectedStatuses.includes(e.status));

    // KPIs update
    if (kpis) {
        const totalBinsCount = kpis.totalBins || 0;
        
        const isAssigned = selectedStatuses.includes('assigned');
        const assignedVal = isAssigned ? (kpis.assigned || 0) : 0;
        const assignedPct = totalBinsCount > 0 ? ((assignedVal / totalBinsCount) * 100).toFixed(1) + '%' : '0%';
        document.getElementById('kpiAssigned').textContent = assignedVal;
        const subAssigned = document.getElementById('kpiAssignedSub');
        if (subAssigned) subAssigned.innerHTML = isAssigned ? `<span class="bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded mr-1 font-bold">${assignedPct}</span> <b class="text-content-secondary">${kpis.assigned8D || 0}</b> de 8 dígitos, <b class="text-content-secondary">${kpis.assignedHijos || 0}</b> derivados` : '...';

        const isAvailable = selectedStatuses.includes('available');
        const availableVal = isAvailable ? (kpis.available || 0) : 0;
        const availablePct = totalBinsCount > 0 ? ((availableVal / totalBinsCount) * 100).toFixed(1) + '%' : '0%';
        document.getElementById('kpiAvailable').textContent = availableVal;
        const subAvailable = document.getElementById('kpiAvailableSub');
        if (subAvailable) subAvailable.innerHTML = isAvailable ? `<span class="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded mr-1 font-bold">${availablePct}</span> <b class="text-content-secondary">${kpis.available8D || 0}</b> de 8 dígitos, <b class="text-content-secondary">${kpis.availableHijos || 0}</b> derivados` : '...';

        const isOnHold = selectedStatuses.includes('on_hold');
        document.getElementById('kpiOnHold').textContent = isOnHold ? (kpis.onHold || 0) : 0;
        const subHold = document.getElementById('kpiOnHoldSub');
        if (subHold) subHold.innerHTML = isOnHold ? `<b class="text-content-secondary">${kpis.onHold8D || 0}</b> de 8 dígitos, <b class="text-content-secondary">${kpis.onHoldHijos || 0}</b> derivados` : '...';

        const isSegmented = selectedStatuses.includes('segmented');
        document.getElementById('kpiSegmented').textContent = isSegmented ? (kpis.segmented || 0) : 0;
        const subSegmented = document.getElementById('kpiSegmentedSub');
        if (subSegmented) subSegmented.innerHTML = isSegmented ? `<b class="text-content-secondary">${kpis.segmented8D || 0}</b> de 8 dígitos, <b class="text-content-secondary">${kpis.segmentedHijos || 0}</b> derivados` : '...';
        
        // Total BINs remains the grand total to give context to the subtitle
        document.getElementById('kpiTotalBins').textContent = totalBinsCount;
        
        const totalSub = document.getElementById('kpiTotalSub');
        if (totalSub) {
            totalSub.innerHTML = `<b class="text-content-secondary">${kpis.total8D || 0}</b> originales de 8 dígitos, <b class="text-content-secondary">${kpis.totalHijos || 0}</b> derivados de <b class="text-content-secondary">${kpis.totalPadres || 0}</b> padres`;
        }
    }

    // --- Chart 1: Producto vs Estado ---
    const ctxProduct = document.getElementById('productStatusChart');
    if (ctxProduct) {
        if (window.productChart) window.productChart.destroy();
        
        // pivotProducto: { product, assigned, available, on_hold, segmented }
        const labels = ['Crédito', 'Débito', 'Prepago'];
        
        const getVal = (prodName, statusKey) => {
            if(!pivotProducto) return 0;
            const row = pivotProducto.find(p => p.product.toLowerCase().includes(prodName.toLowerCase()));
            return row ? (parseInt(row[statusKey]) || 0) : 0;
        };

        const datasets = [];
        if (selectedStatuses.includes('assigned')) datasets.push({ label: 'Assigned', data: labels.map(l => getVal(l, 'assigned')), backgroundColor: window.statusColors.assigned, borderRadius: 4 });
        if (selectedStatuses.includes('available')) datasets.push({ label: 'Available', data: labels.map(l => getVal(l, 'available')), backgroundColor: window.statusColors.available, borderRadius: 4 });
        if (selectedStatuses.includes('on_hold')) datasets.push({ label: 'On Hold', data: labels.map(l => getVal(l, 'on_hold')), backgroundColor: window.statusColors.on_hold, borderRadius: 4 });
        if (selectedStatuses.includes('segmented')) datasets.push({ label: 'Segmented', data: labels.map(l => getVal(l, 'segmented')), backgroundColor: window.statusColors.segmented, borderRadius: 4 });

        window.productChart = new Chart(ctxProduct.getContext('2d'), {
            type: 'bar',
            data: { labels, datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8 } },
                    tooltip: { mode: 'index', intersect: false, backgroundColor: 'rgba(15, 23, 42, 0.9)', padding: 12, cornerRadius: 8 }
                },
                scales: {
                    x: { grid: { display: false } },
                    y: { beginAtZero: true, border: { display: false } }
                },
                interaction: { mode: 'nearest', axis: 'x', intersect: false }
            }
        });
    }

    // --- Chart 2: Dominancia por Producto (Donut) ---
    const ctxDonut = document.getElementById('productDonutChart');
    if (ctxDonut) {
        if (window.donutChartInstance && typeof window.donutChartInstance.destroy === 'function') {
            window.donutChartInstance.destroy();
        }
        
        const getSum = (prodName) => {
            if(!pivotProducto) return 0;
            const row = pivotProducto.find(p => (p.product || '').toLowerCase().includes(prodName.toLowerCase()));
            return row ? (parseInt(row.total) || 0) : 0;
        };

        const dData = [getSum('Crédito'), getSum('Débito'), getSum('Prepago')];
        const dColors = [window.productColors.credito, window.productColors.debito, window.productColors.prepago];

        window.donutChartInstance = new Chart(ctxDonut.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Crédito', 'Débito', 'Prepago'],
                datasets: [{
                    data: dData,
                    backgroundColor: dColors,
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } },
                    tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.9)', padding: 12, cornerRadius: 8 }
                }
            }
        });
    }

    // SECCIÓN 2: Llenar Tabla Visual de Países y KPIs
    const pivotGeo = {};
    let totalPrepagoGeo = 0, totalCreditoGeo = 0, totalDebitoGeo = 0;
    filteredDistrib.forEach(d => {
        if (!pivotGeo[d.country]) pivotGeo[d.country] = { credito: 0, debito: 0, prepago: 0 };
        const prod = (d.product || '').toLowerCase();
        if (prod.includes('crédito') || prod.includes('credito')) { pivotGeo[d.country].credito++; totalCreditoGeo++; }
        else if (prod.includes('débito') || prod.includes('debito')) { pivotGeo[d.country].debito++; totalDebitoGeo++; }
        else if (prod.includes('prepago')) { pivotGeo[d.country].prepago++; totalPrepagoGeo++; }
    });

    const countries = Object.keys(pivotGeo).sort((a,b) => {
        const totalA = pivotGeo[a].prepago + pivotGeo[a].credito + pivotGeo[a].debito;
        const totalB = pivotGeo[b].prepago + pivotGeo[b].credito + pivotGeo[b].debito;
        return totalB - totalA; // Sort DESC by volume
    });

    const countryVisualBody = document.getElementById('tableCountryVisualBody');
    if (countryVisualBody) {
        countryVisualBody.innerHTML = countries.map(c => {
            const row = pivotGeo[c];
            const total = row.prepago + row.credito + row.debito;
            const maxVal = Math.max(row.prepago, row.credito, row.debito);
            
            const cellVal = (val, colorCode) => {
                if (val === 0) return `<td class="px-6 py-3.5 text-center text-content-muted font-medium">-</td>`;
                if (val === maxVal) return `<td class="px-6 py-3.5 text-center font-bold text-${colorCode}-600 bg-${colorCode}-50/30">${val}</td>`;
                return `<td class="px-6 py-3.5 text-center font-bold text-${colorCode}-600">${val}</td>`;
            };

            return `
            <tr class="hover:bg-surface-hover transition-colors">
                <td class="px-6 py-3.5 font-medium text-content-primary flex items-center gap-2">
                    ${getFlag(c)} <span class="truncate">${c}</span>
                </td>
                ${cellVal(row.credito, 'purple')}
                ${cellVal(row.debito, 'amber')}
                ${cellVal(row.prepago, 'blue')}
                <td class="px-6 py-3.5 text-center font-bold text-slate-800">${total}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="5" class="px-6 py-4 text-center text-content-muted">Sin datos geográficos</td></tr>';
        
        if (countries.length > 0) {
             const sumCredito = countries.reduce((sum, c) => sum + pivotGeo[c].credito, 0);
             const sumDebito = countries.reduce((sum, c) => sum + pivotGeo[c].debito, 0);
             const sumPrepago = countries.reduce((sum, c) => sum + pivotGeo[c].prepago, 0);
             const sumTotal = sumCredito + sumDebito + sumPrepago;
             
             countryVisualBody.innerHTML += `
             <tr class="bg-canvas/80 border-t border-divider">
                <td class="px-6 py-4 font-bold text-slate-800">TOTAL GENERAL</td>
                <td class="px-6 py-4 text-center font-bold text-purple-700">${sumCredito}</td>
                <td class="px-6 py-4 text-center font-bold text-amber-700">${sumDebito}</td>
                <td class="px-6 py-4 text-center font-bold text-blue-700">${sumPrepago}</td>
                <td class="px-6 py-4 text-center font-black text-content-primary">${sumTotal}</td>
             </tr>
             `;
        }
    }

    const maxProdVol = Math.max(totalPrepagoGeo, totalCreditoGeo, totalDebitoGeo);
    let topProd = '-';
    if (maxProdVol > 0) {
        if (maxProdVol === totalPrepagoGeo) topProd = 'Prepago';
        else if (maxProdVol === totalCreditoGeo) topProd = 'Crédito';
        else topProd = 'Débito';
    }

    const distinctIcas = new Set(filteredIcas.map(i => i.ica)).size;
    
    const icasPerCountry = {};
    filteredIcas.forEach(i => {
        if (!icasPerCountry[i.country]) icasPerCountry[i.country] = new Set();
        icasPerCountry[i.country].add(i.ica);
    });

    let topCountryByIca = '-';
    let maxIcas = 0;
    Object.keys(icasPerCountry).forEach(c => {
        if (icasPerCountry[c].size > maxIcas) {
            maxIcas = icasPerCountry[c].size;
            topCountryByIca = c;
        }
    });
    const topCountryText = maxIcas > 0 ? `${topCountryByIca} (${maxIcas})` : '-';

    if (document.getElementById('kpiGeoActive')) document.getElementById('kpiGeoActive').textContent = countries.length;
    if (document.getElementById('kpiGeoTotalIcas')) document.getElementById('kpiGeoTotalIcas').textContent = distinctIcas;
    if (document.getElementById('kpiGeoTopCountry')) document.getElementById('kpiGeoTopCountry').textContent = topCountryText;
    if (document.getElementById('kpiGeoTopProduct')) document.getElementById('kpiGeoTopProduct').textContent = topProd;

    // Render ICAs Table
    const icasBody = document.getElementById('tableIcasBody');
    if (icasBody) {
        icasBody.innerHTML = filteredIcas.map(i => {
            const clientName = (i.client && i.client !== 'null') ? i.client : '-';
            const icaQmr = (i.ica_qmr && i.ica_qmr !== 'null') ? i.ica_qmr : '-';
            return `
            <tr class="hover:bg-surface-hover transition-colors">
                <td class="px-6 py-3.5 font-medium text-sm text-content-primary flex items-center gap-2">
                    ${getFlag(i.country)} <span class="truncate">${i.country}</span>
                </td>
                <td class="px-6 py-3.5 text-content-secondary font-mono text-sm">${i.ica}</td>
                <td class="px-6 py-3.5 text-content-secondary font-mono text-sm">${icaQmr}</td>
                <td class="px-6 py-3.5 font-mono text-content-secondary text-sm">${i.bin_number}</td>
                <td class="px-6 py-3.5 font-normal text-content-secondary text-sm">${clientName}</td>
                <td class="px-6 py-3.5 text-right">${getStatusBadge(i.status)}</td>
            </tr>
            `;
        }).join('') || '<tr><td colspan="6" class="px-6 py-4 text-center text-content-muted">Sin datos</td></tr>';
    }

    // SECCIÓN 3: Embozadores KPIs y Tabla
    const embCount = new Set();
    let assignedEmbBins = 0;
    let pendingEmbBins = 0;
    const embCounts = {};
    
    filteredEmbozadores.forEach(e => {
        if (e.embosser && e.embosser !== 'Sin Embozador') {
            embCount.add(e.embosser);
            embCounts[e.embosser] = (embCounts[e.embosser] || 0) + 1;
        }
        if (e.status === 'assigned') assignedEmbBins++;
        if (e.status === 'on_hold') pendingEmbBins++;
    });

    let topPartner = '-';
    let maxPartnerVol = 0;
    Object.entries(embCounts).forEach(([emb, vol]) => {
        if (vol > maxPartnerVol) { maxPartnerVol = vol; topPartner = emb; }
    });

    const elEmbCount = document.getElementById('kpiEmbCount');
    const elEmbAssigned = document.getElementById('kpiEmbAssigned');
    const elEmbPending = document.getElementById('kpiEmbPending');
    const elEmbTop = document.getElementById('kpiEmbTop');

    const topPartnerText = maxPartnerVol > 0 ? `${topPartner} (${maxPartnerVol})` : '-';

    if (elEmbCount) elEmbCount.textContent = embCount.size;
    if (elEmbAssigned) elEmbAssigned.textContent = assignedEmbBins;
    if (elEmbPending) elEmbPending.textContent = pendingEmbBins;
    if (elEmbTop) elEmbTop.textContent = topPartnerText;

    // Render Embozadores Table
    const embozadoresBody = document.getElementById('tableEmbozadoresBody');
    if (embozadoresBody) {
        embozadoresBody.innerHTML = filteredEmbozadores.map(e => {
            const clientName = (e.client && e.client !== 'null') ? e.client : '-';
            return `
            <tr class="hover:bg-surface-hover transition-colors group">
                <td class="px-6 py-3.5 font-medium text-sm text-content-primary">
                    <div class="flex items-center gap-3">
                        ${getEmbosserAvatar(e.embosser)}
                        <span>${e.embosser}</span>
                    </div>
                </td>
                <td class="px-6 py-3.5 text-content-secondary text-sm font-normal">${clientName}</td>
                <td class="px-6 py-3.5 text-content-primary font-medium text-sm">
                    <div class="flex items-center gap-2">${getFlag(e.country)} <span class="truncate max-w-[120px]" title="${e.country}">${e.country}</span></div>
                </td>
                <td class="px-6 py-3.5 font-mono text-content-secondary text-sm">${e.bin_number}</td>
                <td class="px-6 py-3.5 text-center">${getProductBadge(e.product)}</td>
                <td class="px-6 py-3.5 text-center">${getStatusBadge(e.status)}</td>
            </tr>
            `;
        }).join('') || '<tr><td colspan="6" class="px-6 py-4 text-center text-content-muted">Sin datos de embozadores</td></tr>';
    }
}

async function updatePendingBadge() {
    try {
        const res = await api('/api/requests?status=pending');
        const pending = await res.json();
        const badge = document.getElementById('pendingBadge');
        if (pending.length > 0) {
            badge.textContent = pending.length;
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }
    } catch (e) { /* ignore */ }
}

// ========== BINs ==========
function buildFilterParams() {
    const params = new URLSearchParams();
    const search = document.getElementById('searchInput')?.value || '';
    const parentOnly = document.getElementById('filterParentOnly')?.checked || false;
    if (search) params.set('search', search);
    if (parentOnly) params.set('parent_only', 'true');
    // Multi-value filters
    const paramMap = {
        country: 'country', status: 'status', brand: 'brand',
        bin_length: 'bin_length', segment: 'segment', product: 'product',
        bin_type: 'bin_type', embosser: 'embosser', ica: 'ica',
        client: 'client', billeteras: 'billeteras', balance_type: 'balance_type', bin_tokenizado: 'bin_tokenizado'
    };
    Object.entries(paramMap).forEach(([filterKey, paramKey]) => {
        const vals = activeFilters[filterKey];
        if (vals && vals.size > 0) {
            vals.forEach(v => params.append(paramKey, v));
        }
    });
    return params;
}

async function loadBins() {
    try {
        const params = buildFilterParams();
        params.set('sort', currentSort.column);
        params.set('order', currentSort.order);
        const res = await api(`/api/bins?${params}`);
        if (res.status === 401 || res.status === 403) return;
        binsData = await res.json();
        currentPage = 1;
        renderBinsTable(binsData);
        updateFilterSummary();
        updateSmartFilters();
    } catch (e) { console.error('Error loading bins:', e); }
}

function updateSmartFilters() {
    if (!binsData) return;

    const availableOptions = {
        country: new Set(), status: new Set(), brand: new Set(),
        bin_length: new Set(), segment: new Set(), product: new Set(),
        bin_type: new Set(), embosser: new Set(), ica: new Set(),
        client: new Set(), billeteras: new Set(), balance_type: new Set(), bin_tokenizado: new Set()
    };

    binsData.forEach(bin => {
        if (bin.country) availableOptions.country.add(bin.country);
        if (bin.status) availableOptions.status.add(bin.status);
        if (bin.brand) availableOptions.brand.add(bin.brand);
        if (bin.bin_length) availableOptions.bin_length.add(String(bin.bin_length));
        if (bin.segment) availableOptions.segment.add(bin.segment);
        if (bin.product) availableOptions.product.add(bin.product);
        if (bin.bin_type) availableOptions.bin_type.add(bin.bin_type);
        if (bin.embosser) availableOptions.embosser.add(bin.embosser);
        if (bin.ica) availableOptions.ica.add(bin.ica);
        if (bin.client) availableOptions.client.add(bin.client);
        if (bin.bin_tokenizado) availableOptions.bin_tokenizado.add(bin.bin_tokenizado);
        if (bin.billeteras) availableOptions.billeteras.add(bin.billeteras);
        if (bin.balance_type) availableOptions.balance_type.add(bin.balance_type);
    });

    document.querySelectorAll('.multiselect-dropdown').forEach(el => {
        const filterKey = el.dataset.filter;
        const isActive = activeFilters[filterKey] && activeFilters[filterKey].size > 0;
        
        el.querySelectorAll('.ms-option').forEach(optLabel => {
            const cb = optLabel.querySelector('input[type=checkbox]');
            const val = cb.value;
            
            if (isActive) {
                // If filter is active, show all its options so user can toggle them
                optLabel.classList.remove('hidden-option');
            } else {
                // If not active, only show options that exist in current results
                if (availableOptions[filterKey] && availableOptions[filterKey].has(val)) {
                    optLabel.classList.remove('hidden-option');
                } else {
                    optLabel.classList.add('hidden-option');
                }
            }
        });
    });
}

function filterByClient(clientName) {
    if (!activeFilters['client']) activeFilters['client'] = new Set();
    activeFilters['client'].clear();
    activeFilters['client'].add(clientName);
    // Re-render the client multiselect
    const msEl = document.getElementById('msClient');
    if (msEl && msEl._renderMs) msEl._renderMs();
    navigateTo('bins');
    loadBins();
    updateFilterSummary();
}

function renderBinsTable(bins) {
    const isAdmin = currentUser && currentUser.role === 'admin';
    const body = document.getElementById('binsTableBody');
    // Dynamic colCount based on visible columns
    const visibleCols = BINS_COL_CONFIG.filter(c => colVisibility[c.key] !== false).length;
    const colCount = visibleCols + (isAdmin ? 1 : 0);

    const totalPages = Math.ceil(bins.length / PAGE_SIZE);
    if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageBins = bins.slice(start, start + PAGE_SIZE);

    const end = Math.min(start + PAGE_SIZE, bins.length);
    document.getElementById('binsCount').textContent =
        bins.length === 0 ? '0 BINes' :
        `Mostrando ${start + 1}–${end} de ${bins.length} BINes`;

    if (bins.length === 0) {
        body.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;padding:40px;color:var(--text-muted)">No se encontraron BINes</td></tr>`;
        renderPagination(0, colCount);
        return;
    }

    body.innerHTML = pageBins.map(bin => {
        const segInfo = bin.total_segments ? ` <span class="seg-badge" onclick="viewSegments('${bin.bin_number}')" title="${bin.available_segments} disponibles de ${bin.total_segments}">📊 ${bin.available_segments}/${bin.total_segments}</span>` : '';
        const allAvailable = bin.total_segments > 0 && bin.available_segments === bin.total_segments;
        const isSegmentedParent = isAdmin && bin.status === 'segmented' && bin.parent_bin === null;
        let unsegBtn = '';
        if (isSegmentedParent) {
            if (allAvailable) {
                unsegBtn = `<button class="btn text-xs bg-red-100 hover:bg-red-200 text-red-700 font-bold px-3 py-1.5 rounded-md shadow-sm transition-colors border border-red-200 flex items-center gap-1" onclick="unsegmentBin(${bin.id}, '${bin.bin_number}')" title="Eliminar segmentos y regresar a BIN 8"><i class="ph ph-arrows-merge"></i> Desegmentar</button>`;
            } else {
                unsegBtn = `<button class="btn text-xs bg-slate-100 text-slate-400 font-bold px-3 py-1.5 rounded-md border border-slate-200 flex items-center gap-1 cursor-not-allowed" title="Debes liberar todos los hijos (${bin.total_segments - bin.available_segments} en uso) antes de desegmentar"><i class="ph ph-arrows-merge"></i> Desegmentar</button>`;
            }
        }
        const canHold = isAdmin && !['segmented', 'exhausted', 'on_hold'].includes(bin.status) && bin.parent_bin === null;
        const holdBtn = canHold ? `<button class="btn-icon" onclick="holdBin(${bin.id}, '${bin.bin_number}')" title="Poner En Espera">⏸️</button>` : '';
        const clientName = (bin.client && bin.client !== 'null') ? bin.client : '—';
        const clientHtml = clientName !== '—' ? `<a href="#" class="text-blue-600 hover:text-blue-800 hover:underline" onclick="filterByClient('${clientName.replace(/'/g, "\\'")}'); return false;">${clientName}</a>` : `<span class="text-content-muted">—</span>`;
        return `<tr class="hover:bg-surface-hover transition-colors group border-b border-divider last:border-0">
            <td class="col-country sticky left-0 bg-surface z-10 shadow-[1px_0_0_#e2e8f0] px-6 py-4 font-medium text-content-primary group-hover:bg-surface-hover transition-colors">
                <div class="flex items-center gap-2">${getFlag(bin.country)} <span>${bin.country || '—'}</span></div>
            </td>
            <td class="col-ica px-6 py-4 font-mono text-content-muted">${bin.ica || `<span class="text-content-muted">—</span>`}</td>
            <td class="col-ica-qmr px-6 py-4 font-mono text-content-muted">${(bin.ica_qmr && bin.ica_qmr !== 'null') ? bin.ica_qmr : `<span class="text-content-muted">—</span>`}</td>
            <td class="col-bin px-6 py-4 font-mono font-bold bg-status-info-bg text-status-info-txt group-hover:bg-status-info-bg transition-colors"><code>${bin.bin_number}</code>${segInfo}</td>
            <td class="col-digits px-6 py-4 text-content-secondary">${bin.bin_length}</td>
            <td class="col-brand px-6 py-4">${bin.brand ? `<span class="brand-badge brand-${bin.brand.toLowerCase()}">${bin.brand}</span>` : `<span class="text-content-muted">—</span>`}</td>
            <td class="col-product px-6 py-4 text-content-secondary">${bin.product || `<span class="text-content-muted">—</span>`}</td>
            <td class="col-segment px-6 py-4">${getSaaSSegmentBadge(bin.segment)}</td>
            <td class="col-status px-6 py-4">${statusBadge(bin.status)}</td>
            <td class="col-client px-6 py-4 font-normal text-content-secondary">${clientHtml}</td>
            <td class="col-bin-tok px-6 py-4">${getSaaSTokenBadge(bin.bin_tokenizado)}</td>
            <td class="col-billeteras px-6 py-4 text-content-secondary">${bin.billeteras || `<span class="text-content-muted">—</span>`}</td>
            <td class="col-bin-type px-6 py-4 text-content-secondary">${bin.bin_type || `<span class="text-content-muted">—</span>`}</td>
            <td class="col-embosser px-6 py-4 font-medium text-content-secondary">${bin.embosser || `<span class="text-content-muted">—</span>`}</td>
            <td class="col-balance px-6 py-4 text-content-secondary">${bin.balance_type || `<span class="text-content-muted">—</span>`}</td>
            ${isAdmin ? `<td class="col-actions actions-cell px-6 py-4">
                <button class="btn-icon" onclick="editBin(${bin.id})" title="Editar">✏️</button>
                
                ${bin.status === 'assigned' ? `<button class="btn-icon" onclick="releaseBin(${bin.id})" title="Liberar">🔓</button>` : ''}
                ${holdBtn}
                ${unsegBtn}
                <button class="btn-icon" onclick="deleteBin(${bin.id})" title="Eliminar">🗑️</button>
            </td>` : ''}
        </tr>`;
    }).join('');

    renderPagination(totalPages, colCount);
}

// ========== Column Visibility ==========
function initColVisibility() {
    const saved = localStorage.getItem('binColVisibility');
    if (saved) {
        try { colVisibility = JSON.parse(saved); } catch(e) {}
    }
    // Apply defaults for any missing keys
    BINS_COL_CONFIG.forEach(c => {
        if (colVisibility[c.key] === undefined) colVisibility[c.key] = c.defaultVis;
    });
    applyColVisibility();
    renderColPicker();
}

function applyColVisibility() {
    let css = '';
    BINS_COL_CONFIG.forEach(c => {
        if (!colVisibility[c.key]) css += `.${c.cls} { display: none !important; }\n`;
    });
    let el = document.getElementById('colVisStyle');
    if (!el) {
        el = document.createElement('style');
        el.id = 'colVisStyle';
        document.head.appendChild(el);
    }
    el.textContent = css;
}

function toggleColVis(key) {
    colVisibility[key] = !colVisibility[key];
    localStorage.setItem('binColVisibility', JSON.stringify(colVisibility));
    applyColVisibility();
    renderColPicker();
}

function renderColPicker() {
    const panel = document.getElementById('colPickerPanel');
    if (!panel) return;
    panel.innerHTML =
        `<div class="px-4 py-2 border-b border-divider mb-1">
            <p class="text-xs font-bold text-content-muted uppercase tracking-wider">Columnas Visibles</p>
        </div>` +
        `<div class="max-h-64 overflow-y-auto px-2 space-y-1">` +
        BINS_COL_CONFIG.map(c =>
            `<label class="flex items-center gap-3 cursor-pointer hover:bg-surface-hover p-2 rounded-lg">
                <input type="checkbox" class="custom-checkbox" ${colVisibility[c.key] ? 'checked' : ''} onchange="toggleColVis('${c.key}')">
                <span class="text-sm font-medium text-content-secondary">${c.label}</span>
            </label>`
        ).join('') +
        `</div>`;
}

function renderPagination(totalPages, colCount) {
    const container = document.getElementById('binsPagination');
    if (!container) return;

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    // Build page number buttons (show at most 7 around current)
    const makeBtn = (label, page, disabled = false, active = false) => {
        const cls = ['pagination-btn', active ? 'active' : '', disabled ? 'disabled' : ''].filter(Boolean).join(' ');
        const onclick = (!disabled && !active) ? `onclick="goToPage(${page})"` : '';
        return `<button class="${cls}" ${onclick} ${disabled ? 'disabled' : ''}>${label}</button>`;
    };

    let pages = '';
    const delta = 2;
    const left = Math.max(1, currentPage - delta);
    const right = Math.min(totalPages, currentPage + delta);

    if (left > 1) { pages += makeBtn('1', 1); if (left > 2) pages += `<span class="pagination-ellipsis">…</span>`; }
    for (let i = left; i <= right; i++) pages += makeBtn(i, i, false, i === currentPage);
    if (right < totalPages) { if (right < totalPages - 1) pages += `<span class="pagination-ellipsis">…</span>`; pages += makeBtn(totalPages, totalPages); }

    container.innerHTML = `
        <div class="pagination-bar">
            <span class="pagination-info">Página ${currentPage} de ${totalPages}</span>
            <div class="pagination-controls">
                ${makeBtn('‹ Anterior', currentPage - 1, currentPage === 1)}
                ${pages}
                ${makeBtn('Siguiente ›', currentPage + 1, currentPage === totalPages)}
            </div>
        </div>`;
}

function goToPage(page) {
    currentPage = page;
    renderBinsTable(binsData);
    // Scroll table into view smoothly
    document.getElementById('binsTableBody')?.closest('.table-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function viewSegments(parentBin) {
    try {
        const res = await api(`/api/bins/segments/${parentBin}`);
        const segments = await res.json();
        document.getElementById('segmentsTitle').textContent = `Segmentos de ${parentBin}`;
        const body = document.getElementById('segmentsBody');
        const empty = document.getElementById('segmentsEmpty');

        if (segments.length === 0) {
            body.innerHTML = '';
            empty.classList.remove('hidden');
        } else {
            empty.classList.add('hidden');
            body.innerHTML = segments.map(s =>
                `<tr>
                    <td><code>${s.bin_number}</code></td>
                    <td>${statusBadge(s.status)}</td>
                    <td>${s.client || '—'}</td>
                    <td>${s.billeteras || '-'}</td>
                    <td>${s.product || '—'}</td>
                </tr>`
            ).join('');
        }
        openModal('segmentsModal');
    } catch (e) { showToast('Error al cargar segmentos', 'error'); }
}

// BIN CRUD
function openNewBinModal() {
    document.getElementById('binModalTitle').textContent = 'Nuevo BIN';
    document.getElementById('binForm').reset();
    document.getElementById('binId').value = '';
    document.getElementById('binStatus').value = 'available';
    // Mostrar campo bin_tokenizado solo al crear
    const tokGroup = document.getElementById('binTokenizadoGroup');
    if (tokGroup) tokGroup.style.display = '';
    openModal('binModal');
}

async function editBin(id) {
    try {
        const res = await api(`/api/bins/${id}`);
        const bin = await res.json();
        document.getElementById('binModalTitle').textContent = 'Editar BIN';
        document.getElementById('binId').value = bin.id;
        document.getElementById('binCountry').value = bin.country || '';
        document.getElementById('binIca').value = bin.ica || '';
        document.getElementById('binIcaQmr').value = bin.ica_qmr || '';
        document.getElementById('binNumber').value = bin.bin_number;
        document.getElementById('binBrand').value = bin.brand || '';
        document.getElementById('binProduct').value = bin.product || '';
        document.getElementById('binClient').value = bin.client || '';
        document.getElementById('binBilleteras').value = bin.billeteras || '';
        document.getElementById('binKeys').value = bin.keys || '';
        document.getElementById('binEmbosser').value = bin.embosser || '';
        document.getElementById('binType').value = bin.bin_type || '';
        document.getElementById('binBalanceType').value = bin.balance_type || '';
        document.getElementById('binStatus').value = bin.status || 'available';

        // Add segment logic:
        const segmentSel = document.getElementById('binSegment');
        if (segmentSel) {
            if (bin.product && PRODUCT_SEGMENTS[bin.product]) {
                segmentSel.innerHTML = '<option value="">Seleccionar...</option>' + 
                    PRODUCT_SEGMENTS[bin.product].map(s => `<option value="${s}">${s}</option>`).join('');
                segmentSel.disabled = false;
                segmentSel.value = bin.segment || '';
            } else {
                segmentSel.innerHTML = '<option value="">Primero seleccione Producto...</option>';
                segmentSel.disabled = true;
            }
        }
        document.getElementById('binNotes').value = bin.notes || '';
        // Mostrar campo bin_tokenizado en modo edición
        const tokSelect = document.getElementById('binTokenizado');
        if (tokSelect) tokSelect.value = bin.bin_tokenizado || 'No';
        const tokGroup = document.getElementById('binTokenizadoGroup');
        if (tokGroup) tokGroup.style.display = '';
        openModal('binModal');
    } catch (e) { showToast('Error al cargar BIN', 'error'); }
}

async function saveBin() {
    const id = document.getElementById('binId').value;
    const data = {
        country: document.getElementById('binCountry').value,
        ica: document.getElementById('binIca').value,
        ica_qmr: document.getElementById('binIcaQmr').value,
        bin_number: document.getElementById('binNumber').value,
        brand: document.getElementById('binBrand').value,
        product: document.getElementById('binProduct').value,
        segment: document.getElementById('binSegment') ? document.getElementById('binSegment').value : '',
        client: document.getElementById('binClient').value,
        billeteras: document.getElementById('binBilleteras').value,
        keys: document.getElementById('binKeys').value,
        embosser: document.getElementById('binEmbosser').value,
        bin_type: document.getElementById('binType').value,
        balance_type: document.getElementById('binBalanceType').value,
        status: document.getElementById('binStatus').value,
        notes: document.getElementById('binNotes').value,
        bin_tokenizado: document.getElementById('binTokenizado')?.value || 'No'
    };

    try {
        const url = id ? `/api/bins/${id}` : '/api/bins';
        const method = id ? 'PUT' : 'POST';
        const res = await api(url, { method, body: JSON.stringify(data) });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
        showToast(id ? 'BIN actualizado correctamente' : 'BIN creado correctamente');
        closeModal('binModal');
        loadBins();
    } catch (e) { showToast(e.message, 'error'); }
}

function assignBin(id) {
    document.getElementById('confirmTitle').textContent = 'Asignar BIN';
    document.getElementById('confirmMessage').textContent = '¿Está seguro de que desea asignar este BIN?';
    document.getElementById('confirmBtn').onclick = async () => {
        try {
            const res = await api(`/api/bins/${id}/assign`, { method: 'PUT', body: JSON.stringify({}) });
            if (!res.ok) { const r = await res.json(); throw new Error(r.error); }
            showToast('BIN asignado correctamente');
            closeModal('confirmModal');
            loadBins();
        } catch (e) { showToast(e.message, 'error'); }
    };
    openModal('confirmModal');
}

function releaseBin(id) {
    document.getElementById('confirmTitle').textContent = 'Liberar BIN';
    document.getElementById('confirmMessage').textContent = '¿Está seguro de que desea liberar este BIN? El estado regresará a Disponible.';
    document.getElementById('confirmBtn').onclick = async () => {
        try {
            const res = await api(`/api/bins/${id}/release`, { method: 'PUT' });
            if (!res.ok) { const r = await res.json(); throw new Error(r.error); }
            showToast('BIN liberado correctamente');
            closeModal('confirmModal');
            loadBins();
        } catch (e) { showToast(e.message, 'error'); }
    };
    openModal('confirmModal');
}

function deleteBin(id) {
    Swal.fire({
        title: '¿Eliminar BIN?',
        text: '¿Está seguro de que desea eliminar este BIN? Si es un BIN padre, se eliminarán también todos sus segmentos.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const res = await api(`/api/bins/${id}`, { method: 'DELETE' });
                if (!res.ok) { const r = await res.json(); throw new Error(r.error); }
                Swal.fire('¡Eliminado!', 'El BIN ha sido eliminado.', 'success');
                loadBins();
            } catch (e) {
                Swal.fire('Error', e.message, 'error');
            }
        }
    });
}

function releaseBin(id) {
    document.getElementById('confirmTitle').textContent = 'Liberar BIN';
    document.getElementById('confirmMessage').textContent = '¿Está seguro de que desea liberar este BIN? El estado regresará a Disponible.';
    document.getElementById('confirmBtn').onclick = async () => {
        try {
            const res = await api(`/api/bins/${id}/release`, { method: 'PUT' });
            if (!res.ok) { const r = await res.json(); throw new Error(r.error); }
            showToast('BIN liberado correctamente');
            closeModal('confirmModal');
            loadBins();
        } catch (e) { showToast(e.message, 'error'); }
    };
    openModal('confirmModal');
}

function deleteBin(id) {
    document.getElementById('confirmTitle').textContent = 'Eliminar BIN';
    document.getElementById('confirmMessage').textContent = '¿Está seguro de que desea eliminar este BIN? Si es un BIN padre, se eliminarán también todos sus segmentos.';
    document.getElementById('confirmBtn').className = 'btn btn-danger';
    document.getElementById('confirmBtn').onclick = async () => {
        try {
            const res = await api(`/api/bins/${id}`, { method: 'DELETE' });
            if (!res.ok) { const r = await res.json(); throw new Error(r.error); }
            showToast('BIN eliminado correctamente');
            closeModal('confirmModal');
            loadBins();
        } catch (e) { showToast(e.message, 'error'); }
    };
    openModal('confirmModal');
}

// ========== Segment Creation ==========
async function createSegments() {
    const parentBin = document.getElementById('segParentBin').value.trim();
    const targetLength = parseInt(document.getElementById('segTargetLength').value);
    const embosser = document.getElementById('segEmbosser').value;

    if (!parentBin) { showToast('Ingrese el BIN padre', 'error'); return; }

    try {
        const res = await api('/api/bins/segment', {
            method: 'POST',
            body: JSON.stringify({ parent_bin_number: parentBin, target_length: targetLength, embosser: embosser })
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
        showToast(result.message);
        closeModal('segmentModal');
        loadBins();
    } catch (e) { showToast(e.message, 'error'); }
}

// ========== Requests ==========
async function submitRequest() {
    const submitBtn = document.querySelector('#requestForm button[onclick="submitRequest()"], button[onclick="submitRequest()"]') || document.getElementById('submitRequestBtn');
    if (submitBtn && submitBtn.disabled) return; // Prevent double submit
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '⏳ Enviando...'; }

    const isAdmin = currentUser && currentUser.role === 'admin';
    const embosserSel = document.getElementById('reqEmbosser');
    const embosserValue = embosserSel.options[embosserSel.selectedIndex]?.value || embosserSel.value;

    const data = {
        country: document.getElementById('reqCountry').value,
        digits: document.getElementById('reqDigits').value,
        brand: document.getElementById('reqBrand').value,
        product: document.getElementById('reqProduct').value,
        segment: document.getElementById('reqSegment').value,
        bin_type: document.getElementById('reqBinType').value,
        client: document.getElementById('reqClient').value,
        billeteras: document.getElementById('reqBilleteras').value,
        keys: document.getElementById('reqKeys').value,
        embosser: embosserValue,
        balance_type: document.getElementById('reqBalanceType').value,
        requiere_tokenizacion: document.getElementById('reqRequiereTokenizacion').value
    };

    // Frontend validation
    const resetBtn = () => { if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '💾 Enviar Solicitud'; } };
    if (!data.country) { resetBtn(); showToast('Seleccione un país', 'error'); return; }
    if (!data.digits) { resetBtn(); showToast('Seleccione los dígitos', 'error'); return; }
    if (parseInt(data.digits) === 8 && !isAdmin && data.requiere_tokenizacion !== 'Sí' && data.requiere_tokenizacion !== 'S') { resetBtn(); showToast('Solo el administrador puede solicitar BINes de 8 dígitos', 'error'); return; }
    if (!data.brand) { resetBtn(); showToast('Seleccione la marca', 'error'); return; }
    if (!data.product) { resetBtn(); showToast('Seleccione el producto', 'error'); return; }
    if (!data.segment) { resetBtn(); showToast('Seleccione el segmento', 'error'); return; }
    if (!data.bin_type) { resetBtn(); showToast('Seleccione el tipo de BIN', 'error'); return; }
    if (!data.client) { resetBtn(); showToast('El cliente es requerido', 'error'); return; }
    if (!data.billeteras) { resetBtn(); showToast('Seleccione la billetera', 'error'); return; }
    if (!data.keys) { resetBtn(); showToast('Seleccione el tipo de llaves', 'error'); return; }
    if (!data.embosser) { resetBtn(); showToast('Seleccione el embozador', 'error'); return; }
    if (!data.balance_type) { resetBtn(); showToast('Seleccione el tipo de saldos', 'error'); return; }
    if (!data.requiere_tokenizacion) { resetBtn(); showToast('Indique si el BIN requiere tokenización', 'error'); return; }

    try {
        const res = await api('/api/requests', { method: 'POST', body: JSON.stringify(data) });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
        showToast(`Solicitud creada. BIN propuesto: ${result.proposed_bin}`);
        document.getElementById('requestForm').reset();
        // Reset UI state
        const embosserSel2 = document.getElementById('reqEmbosser');
        embosserSel2.disabled = false;
        document.getElementById('embosserMsg').style.display = 'none';
        document.getElementById('reqDigitsMsg').style.display = 'none';
        document.getElementById('reqTokenizadoMsg').style.display = 'none';
        document.getElementById('reqDigits').disabled = false;
        document.getElementById('reqSegment').innerHTML = '<option value="">Primero seleccione Producto...</option>';
        document.getElementById('reqSegment').disabled = true;
        navigateTo('myRequests');
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '💾 Enviar Solicitud'; }
    }
}

// Check embosser restriction when digits change (for segmented BINs)
async function checkEmbosserRestriction() {
    // This frontend restriction was removed because the backend now intelligently
    // allocates segments and auto-segments new BINs if the embosser doesn't match.
    // Leaving this empty to prevent the UI from blocking valid choices.
}

async function loadMyRequests() {
    try {
        const res = await api('/api/requests');
        const requests = await res.json();
        const body = document.getElementById('myRequestsBody');
        body.innerHTML = requests.map(r =>
            `<tr>
                <td>${new Date(r.created_at).toLocaleString('es')}</td>
                <td>${r.client}</td>
                <td>${r.digits}</td>
                <td><code>${r.proposed_bin || '—'}</code></td>
                <td>${r.brand || '—'}</td>
                <td>${r.product || '—'}</td>
                <td>${r.segment || '—'}</td>
                <td><span class="badge ${r.requiere_tokenizacion === 'Sí' ? 'badge-warning' : 'badge-pending'}">${r.requiere_tokenizacion || '—'}</span></td>
                <td>${requestStatusBadge(r.status)}</td>
                <td>${r.admin_username || '—'}</td>
            </tr>`
        ).join('') || '<tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:40px">Sin solicitudes</td></tr>';
    } catch (e) { console.error('My requests error:', e); }
}

// ========== Approvals ==========
async function loadApprovals() {
    try {
        const status = document.getElementById('filterApprovalStatus').value;
        const params = status ? `?status=${status}` : '';
        const res = await api(`/api/requests${params}`);
        const requests = await res.json();
        const body = document.getElementById('approvalsBody');
        body.innerHTML = requests.map(r =>
            `<tr>
                <td>${new Date(r.created_at).toLocaleString('es')}</td>
                <td>${r.requester_username}</td>
                <td>${r.client}</td>
                <td>${r.digits}</td>
                <td><code>${r.proposed_bin || '—'}</code></td>
                <td>${r.country || '—'}</td>
                <td>${r.brand || '—'}</td>
                <td>${r.product || '—'}</td>
                <td>${r.segment || '—'}</td>
                <td>${r.bin_type || '—'}</td>
                <td><span class="badge ${r.requiere_tokenizacion === 'Sí' ? 'badge-warning' : 'badge-pending'}">${r.requiere_tokenizacion || '—'}</span></td>
                <td>${requestStatusBadge(r.status)}</td>
                <td class="actions-cell">
                    ${r.status === 'pending' ? `
                        <button class="btn btn-sm btn-success" onclick="approveRequest(${r.id})">✅ Aprobar</button>
                        <button class="btn btn-sm btn-danger" onclick="rejectRequest(${r.id})">❌ Rechazar</button>
                    ` : `<span style="color:var(--text-muted);font-size:0.8rem">${r.admin_username || ''} — ${r.admin_action_date ? new Date(r.admin_action_date).toLocaleDateString('es') : ''}</span>`}
                </td>
            </tr>`
        ).join('') || '<tr><td colspan="12" style="text-align:center;color:var(--text-muted);padding:40px">Sin solicitudes</td></tr>';
    } catch (e) { console.error('Approvals error:', e); }
}

async function approveRequest(id) {
    try {
        const res = await api(`/api/requests/${id}/approve`, { method: 'PUT' });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
        showToast('Solicitud aprobada');
        loadApprovals();
        updatePendingBadge();
    } catch (e) { showToast(e.message, 'error'); }
}

async function rejectRequest(id) {
    try {
        const res = await api(`/api/requests/${id}/reject`, { method: 'PUT' });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);

        showToast('Solicitud rechazada');
        loadApprovals();
        updatePendingBadge();

        // If first segmentation can be undone, offer it
        if (result.can_unsegment && result.parent_bin_id) {
            document.getElementById('confirmTitle').textContent = '↩️ Des-segmentar BIN';
            document.getElementById('confirmMessage').innerHTML =
                `Este rechazo correspondía a la <strong>primera segmentación</strong> de un BIN.<br><br>
                ¿Desea revertir la segmentación y regresar el BIN a su estado original (BIN 8)?`;
            document.getElementById('confirmBtn').className = 'btn btn-primary';
            document.getElementById('confirmBtn').textContent = '↩️ Revertir Segmentación';
            document.getElementById('confirmBtn').onclick = async () => {
                closeModal('confirmModal');
                await unsegmentBin(result.parent_bin_id, null, true);
            };
            openModal('confirmModal');
        }
    } catch (e) { showToast(e.message, 'error'); }
}

// ========== Hold BIN ==========
function holdBin(id, binNumber) {
    document.getElementById('confirmTitle').textContent = 'Poner BIN En Espera';
    document.getElementById('confirmMessage').innerHTML =
        `¿Desea poner el BIN <strong>${binNumber}</strong> en estado <strong>En Espera</strong>?<br><br>
        El BIN no podrá usarse hasta que se cambie su estado manualmente.`;
    document.getElementById('confirmBtn').className = 'btn btn-primary';
    document.getElementById('confirmBtn').textContent = '⏸️ Poner En Espera';
    document.getElementById('confirmBtn').onclick = async () => {
        try {
            const res = await api(`/api/bins/${id}/hold`, { method: 'PUT' });
            if (!res.ok) { const r = await res.json(); throw new Error(r.error); }
            showToast('BIN puesto En Espera');
            closeModal('confirmModal');
            loadBins();
        } catch (e) { showToast(e.message, 'error'); }
    };
    openModal('confirmModal');
}

// ========== Unsegment BIN ==========
async function unsegmentBin(id, binNumber, skipConfirm = false) {
    const doUnsegment = async () => {
        try {
            const res = await api(`/api/bins/${id}/unsegment`, { method: 'PUT' });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error);
            showToast(result.message);
            closeModal('confirmModal');
            loadBins();
        } catch (e) { showToast(e.message, 'error'); }
    };

    if (skipConfirm) {
        await doUnsegment();
        return;
    }

    document.getElementById('confirmTitle').textContent = `↩️ Regresar a BIN 8`;
    document.getElementById('confirmMessage').innerHTML =
        `¿Está seguro de que desea des-segmentar el BIN <strong>${binNumber}</strong>?<br><br>
        Se eliminarán todos los segmentos y el BIN volverá a estado <strong>Disponible</strong>.`;
    document.getElementById('confirmBtn').className = 'btn btn-danger';
    document.getElementById('confirmBtn').textContent = '↩️ Regresar a BIN 8';
    document.getElementById('confirmBtn').onclick = doUnsegment;
    openModal('confirmModal');
}

// ========== Bulk Import ==========
async function handleBulkImport() {
    const fileInput = document.getElementById('bulkFile');
    const csvText = document.getElementById('bulkCsvData').value.trim();

    let resultData;

    if (fileInput.files.length > 0) {
        // Upload file to backend via FormData
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);

        try {
            const res = await fetch('/api/bins/bulk-file', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            resultData = await res.json();
            if (!res.ok) throw new Error(resultData.error);
        } catch (e) { showToast(e.message, 'error'); return; }
    } else if (csvText) {
        // Parse CSV text and send as JSON
        const bins = parseCSV(csvText);
        if (bins.length === 0) { showToast('No se encontraron datos válidos', 'error'); return; }
        try {
            const res = await api('/api/bins/bulk', { method: 'POST', body: JSON.stringify({ bins }) });
            resultData = await res.json();
            if (!res.ok) throw new Error(resultData.error);
        } catch (e) { showToast(e.message, 'error'); return; }
    } else {
        showToast('Seleccione un archivo o pegue datos CSV', 'error');
        return;
    }

    const resultDiv = document.getElementById('bulkResult');
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `
        <div style="padding:16px;border-radius:8px;background:var(--surface)">
            <p>✅ <strong>${resultData.inserted}</strong> BINes importados</p>
            <p>⏭️ <strong>${resultData.skipped}</strong> omitidos (duplicados o inválidos)</p>
            ${resultData.errors?.length ? `<p style="color:var(--danger);margin-top:8px;font-size:0.8rem">Errores: ${resultData.errors.join(', ')}</p>` : ''}
        </div>`;
    showToast(`${resultData.inserted} BINes importados`);
    fileInput.value = '';
    document.getElementById('bulkCsvData').value = '';
}

function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
    return lines.slice(1).map(line => {
        const vals = line.split(',').map(v => v.trim());
        const obj = {};
        headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
        return obj;
    }).filter(b => b.bin_number);
}

// ========== Users — tabla estilo Ejemplo ==========
async function loadUsers() {
    try {
        const res = await api('/api/users');
        const users = await res.json();
        const grid = document.getElementById('usersGrid');
        const roleLabels = { admin: 'Administrador', viewer: 'Solo Lectura', requester: 'Solicitante' };
        const roleDotColor = { admin: 'var(--color-success)', viewer: 'var(--color-muted)', requester: '#60a5fa' };
        grid.innerHTML = `
        <div class="table-container">
          <div class="table-scroll">
            <table class="users-table">
              <thead><tr>
                <th>Usuario</th>
                <th>Correo Electrónico</th>
                <th>Rol</th>
                <th>Estado</th>
                <th class="col-actions">Acciones</th>
              </tr></thead>
              <tbody>${users.map(u => {
                const init = (u.full_name || u.username).charAt(0).toUpperCase();
                const name = u.full_name || u.username;
                const email = u.email || `${u.username}@volcan.com`;
                const role = roleLabels[u.role] || u.role;
                const dot = roleDotColor[u.role] || 'var(--color-muted)';
                const isSelf = currentUser && u.id === currentUser.id;
                return `<tr>
                  <td><div class="user-table-identity">
                    <div class="user-table-avatar">${init}</div>
                    <div>
                      <div class="user-table-name">${name}</div>
                      <div class="user-table-handle">@${u.username}</div>
                    </div>
                  </div></td>
                  <td><a href="mailto:${email}" class="user-table-email">${email}</a></td>
                  <td><span class="user-table-role"><span class="badge-dot" style="background:${dot}"></span>${role.toUpperCase()}</span></td>
                  <td><span class="user-table-status"><span class="badge-dot" style="background:var(--color-success)"></span>ACTIVO</span></td>
                  <td><div class="actions-cell">
                    <button class="action-btn edit" onclick="editUser(${u.id})">Editar</button>
                    ${!isSelf ? `<button class="action-btn delete" onclick="deleteUser(${u.id}, '${u.username}')">Eliminar</button>` : ''}
                  </div></td>
                </tr>`;
              }).join('')}</tbody>
            </table>
          </div>
        </div>`;
    } catch (e) { console.error('Load users error:', e); }
}


function openNewUserModal() {
    document.getElementById('userModalTitle').textContent = 'Nuevo Usuario';
    document.getElementById('userForm').reset();
    document.getElementById('userId').value = '';
    document.getElementById('userUsername').disabled = false;
    document.getElementById('userPassword').required = true;
    document.getElementById('userRoleSelect').value = 'viewer';
    openModal('userModal');
}

async function editUser(id) {
    try {
        const res = await api('/api/users');
        const users = await res.json();
        const user = users.find(u => u.id === id);
        if (!user) return;

        document.getElementById('userModalTitle').textContent = 'Editar Usuario';
        document.getElementById('userId').value = user.id;
        document.getElementById('userUsername').value = user.username;
        document.getElementById('userUsername').disabled = true;
        document.getElementById('userFullName').value = user.full_name || '';
        document.getElementById('userEmail').value = user.email || '';
        document.getElementById('userPassword').value = '';
        document.getElementById('userPassword').required = false;
        document.getElementById('userRoleSelect').value = user.role;
        openModal('userModal');
    } catch (e) { showToast('Error al cargar usuario', 'error'); }
}

async function saveUser() {
    const id = document.getElementById('userId').value;
    const data = {
        username: document.getElementById('userUsername').value,
        full_name: document.getElementById('userFullName').value,
        email: document.getElementById('userEmail').value,
        password: document.getElementById('userPassword').value,
        role: document.getElementById('userRoleSelect').value
    };

    if (!id && !data.password) { showToast('La contraseña es requerida', 'error'); return; }

    try {
        const url = id ? `/api/users/${id}` : '/api/users';
        const method = id ? 'PUT' : 'POST';
        if (id && !data.password) delete data.password;
        const res = await api(url, { method, body: JSON.stringify(data) });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
        showToast(id ? 'Usuario actualizado' : 'Usuario creado');
        closeModal('userModal');
        loadUsers();
    } catch (e) { showToast(e.message, 'error'); }
}

function deleteUser(id, username) {
    document.getElementById('confirmTitle').textContent = 'Eliminar Usuario';
    document.getElementById('confirmMessage').textContent = `¿Está seguro de que desea eliminar al usuario "${username}"?`;
    document.getElementById('confirmBtn').className = 'btn btn-danger';
    document.getElementById('confirmBtn').onclick = async () => {
        try {
            const res = await api(`/api/users/${id}`, { method: 'DELETE' });
            if (!res.ok) { const r = await res.json(); throw new Error(r.error); }
            showToast('Usuario eliminado');
            closeModal('confirmModal');
            loadUsers();
        } catch (e) { showToast(e.message, 'error'); }
    };
    openModal('confirmModal');
}

// ========== Audit ==========
async function loadAudit() {
    try {
        const params = new URLSearchParams();
        const action = document.getElementById('filterAuditAction').value;
        const from = document.getElementById('filterAuditFrom').value;
        const to = document.getElementById('filterAuditTo').value;
        if (action) params.set('action', action);
        if (from) params.set('from', from);
        if (to) params.set('to', to);

        const res = await api(`/api/audit?${params}`);
        const logs = await res.json();
        const body = document.getElementById('auditBody');
        const actionLabels = {
            CREATE: '🆕 Crear', UPDATE: '✏️ Editar', DELETE: '🗑️ Eliminar',
            ASSIGN: '🔒 Asignar', RELEASE: '🔓 Liberar', SEGMENT: '🔀 Segmentar',
            BULK_IMPORT: '📥 Carga', REQUEST_CREATE: '📝 Solicitud',
            REQUEST_APPROVE: '✅ Aprobar', REQUEST_REJECT: '❌ Rechazar'
        };
        body.innerHTML = logs.map(l =>
            `<tr>
                <td style="white-space:nowrap">${new Date(l.created_at).toLocaleString('es')}</td>
                <td>${l.username || '—'}</td>
                <td>${actionLabels[l.action] || l.action}</td>
                <td>${l.table_name || '—'}</td>
                <td>${l.field || '—'}</td>
                <td>${l.old_value || '—'}</td>
                <td>${l.new_value || '—'}</td>
                <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${l.details || '-'}</td>
                <td>
                    ${l.action === 'DELETE' && l.table_name === 'bins' && l.old_value && l.old_value.startsWith('{') 
                        ? `<button onclick="restoreBin('${l.id}')" class="btn btn-primary" style="padding:4px 8px;font-size:0.75rem;background:#3b82f6;color:white;border-radius:4px;border:none;cursor:pointer;">Restaurar</button>` 
                        : '-'}
                </td>
            </tr>`
        ).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:40px">Sin registros</td></tr>';
    } catch (e) { console.error('Audit error:', e); }
}

// ========== Export TXT (CSV) — two modes ==========
async function exportAll() {
    try {
        showToast('Descargando todos los BINes...', 'info');
        const res = await api('/api/bins?sort=bin_number&order=asc');
        const allBins = await res.json();
        if (!allBins.length) { showToast('No hay datos para exportar', 'warning'); return; }
        downloadAsCSV(allBins, `bines_completo_${new Date().toISOString().split('T')[0]}.txt`);
        showToast(`${allBins.length} BINes exportados (sin filtros)`);
    } catch(e) { showToast('Error al exportar', 'error'); }
}

function exportFiltered() {
    if (!binsData || binsData.length === 0) {
        showToast('No hay datos con los filtros actuales', 'warning');
        return;
    }
    downloadAsCSV(binsData, `bines_filtrado_${new Date().toISOString().split('T')[0]}.txt`);
    showToast(`${binsData.length} BINes exportados (con filtros)`);
}

// ========== Delete All BINs ==========
function deleteAllBins() {
    document.getElementById('confirmTitle').innerHTML = '⚠️ Eliminar Todos los BINes';
    document.getElementById('confirmMessage').innerHTML = '<strong>¿Estás COMPLETAMENTE SEGURO de querer eliminar TODOS los BINes?</strong><br><br>Esta acción no se puede deshacer. Se descargará un respaldo automático antes de borrarlos.';
    document.getElementById('confirmBtn').className = 'btn btn-danger';

    document.getElementById('confirmBtn').onclick = async () => {
        try {
            // 1. Download full backup first
            showToast('Generando respaldo...', 'info');
            const res = await api('/api/bins');
            const allBins = await res.json();
            if (allBins.length > 0) {
                downloadAsCSV(allBins, `bines_backup_${new Date().toISOString().split('T')[0]}.txt`);
            }

            // 2. Delete all
            const delRes = await api('/api/bins/all', { method: 'DELETE' });
            const delData = await delRes.json();
            if (!delRes.ok) throw new Error(delData.error);

            showToast(delData.message);
            closeModal('confirmModal');
            loadBins();
            loadDashboard();
        } catch (e) {
            showToast(e.message, 'error');
            closeModal('confirmModal');
        }
    };
    openModal('confirmModal');
}

function downloadAsCSV(dataArray, filename) {
    if (!dataArray || !dataArray.length) return;
    const headers = Object.keys(dataArray[0]);
    const csvContent = [
        headers.join(','),
        ...dataArray.map(row => headers.map(h => {
            let val = row[h] === null ? '' : String(row[h]);
            if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                val = `"${val.replace(/"/g, '""')}"`;
            }
            return val;
        }).join(','))
    ].join('\n');

    // Make sure we export as generic text so Windows doesn't get confused
    const blob = new Blob([csvContent], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

// ========== Init ==========
document.addEventListener('DOMContentLoaded', () => {
    // Login form
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('loginUsername').value;
        const password = document.getElementById('loginPassword').value;
        const errorDiv = document.getElementById('loginError');

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            token = data.token;
            currentUser = data.user;
            localStorage.setItem('binManagerToken', token);
            errorDiv.style.display = 'none';
            showApp();
        } catch (err) {
            errorDiv.textContent = err.message;
            errorDiv.style.display = 'block';
        }
    });

    // Navigation
    document.querySelectorAll('.nav-item[data-page]').forEach(nav => {
        nav.addEventListener('click', () => navigateTo(nav.dataset.page));
    });

    // Mobile toggle
    safeAddListener('mobileToggle', 'click', () => {
        if (document.getElementById('sidebar')) {
            document.getElementById('sidebar').classList.toggle('open');
        }
    });

    // Logout
    safeAddListener('logoutBtn', 'click', () => {
        document.querySelectorAll('[data-role]').forEach(el => { el.style.display = 'none'; });
        token = null;
        currentUser = null;
        localStorage.removeItem('binManagerToken');
        showLogin();
    });

    // BIN actions
    safeAddListener('addBinBtn', 'click', openNewBinModal);
    safeAddListener('binSaveBtn', 'click', saveBin);
    safeAddListener('segmentBinBtn', 'click', () => openModal('segmentModal'));
    safeAddListener('segCreateBtn', 'click', createSegments);

    // Column picker toggle
    safeAddListener('colPickerBtn', 'click', (e) => {
        e.stopPropagation();
        document.getElementById('colPickerPanel')?.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#colPickerPanel') && !e.target.closest('#colPickerBtn')) {
            document.getElementById('colPickerPanel')?.classList.add('hidden');
        }
    });

    // Filters — search and parent-only are the only direct controls now
    safeAddListener('searchInput', 'input', debounce(() => { loadBins(); updateFilterSummary(); }, 300));
    safeAddListener('filterParentOnly', 'change', () => {
        loadBins();
        updateFilterSummary();
    });


    // Filter Panel Logic
    const filterPanel = document.getElementById('filterSidePanelOverlay');
    safeAddListener('openFilterPanelBtn', 'click', () => {
        filterPanel?.classList.remove('hidden');
    });
    safeAddListener('closeFilterPanelBtn', 'click', () => {
        filterPanel?.classList.add('hidden');
    });
    safeAddListener('filterSideBackdrop', 'click', () => {
        filterPanel?.classList.add('hidden');
    });
    safeAddListener('applyFiltersBtnPanel', 'click', () => {
        filterPanel?.classList.add('hidden');
    });

    // Sort headers
    document.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.sort;
            if (currentSort.column === col) {
                currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort = { column: col, order: 'asc' };
            }
            currentPage = 1;
            loadBins();
        });
    });

    // Users
    safeAddListener('addUserBtn', 'click', openNewUserModal);
    safeAddListener('userSaveBtn', 'click', saveUser);

    // Requests
    safeAddListener('submitRequestBtn', 'click', submitRequest);

    // Approvals filter
    safeAddListener('filterApprovalStatus', 'change', loadApprovals);

    // Bulk import
    safeAddListener('bulkImportBtn', 'click', handleBulkImport);

    // Audit filter
    safeAddListener('filterAuditBtn', 'click', loadAudit);

    // Export dropdown
    safeAddListener('exportDropdownBtn', 'click', (e) => {
        e.stopPropagation();
        document.getElementById('exportDropdownMenu')?.classList.toggle('hidden');
    });
    safeAddListener('exportAllBtn', 'click', () => {
        document.getElementById('exportDropdownMenu')?.classList.add('hidden');
        exportAll();
    });
    safeAddListener('exportFilteredBtn', 'click', () => {
        document.getElementById('exportDropdownMenu')?.classList.add('hidden');
        exportFiltered();
    });
    safeAddListener('deleteAllBinsBtn', 'click', deleteAllBins);

    // Clear Filters
    const clearAllFilters = () => {
        Object.keys(activeFilters).forEach(k => activeFilters[k] = new Set());
        document.querySelectorAll('.multiselect-dropdown').forEach(el => {
            if (el._renderMs) el._renderMs();
        });
        const si = document.getElementById('searchInput');
        if (si) si.value = '';
        const po = document.getElementById('filterParentOnly');
        if (po) po.checked = false;
        loadBins();
        updateFilterSummary();
    };
    safeAddListener('clearFiltersBtn', 'click', clearAllFilters);
    safeAddListener('clearAllFiltersQuick', 'click', clearAllFilters);

    // Close multiselects and export dropdown on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.multiselect-dropdown')) closeAllMultiselects(null);
        if (!e.target.closest('.export-dropdown-container')) {
            document.getElementById('exportDropdownMenu')?.classList.add('hidden');
        }
    });

    // Clear Request Form
    safeAddListener('clearRequestFormBtn', 'click', () => {
        const isAdminClear = currentUser && currentUser.role === 'admin';
        const fields = ['reqCountry', 'reqDigits', 'reqBrand', 'reqProduct', 'reqBinType', 'reqClient', 'reqBilleteras', 'reqKeys', 'reqEmbosser', 'reqBalanceType'];
        fields.forEach(f => { if(document.getElementById(f)) document.getElementById(f).value = ''; });
        
        const rd = document.getElementById('reqDigits');
        if (rd) rd.disabled = !isAdminClear;
        
        const rdm = document.getElementById('reqDigitsMsg');
        if (rdm) rdm.style.display = 'none';
        
        const rs = document.getElementById('reqSegment');
        if (rs) {
            rs.innerHTML = '<option value="">Primero seleccione Producto...</option>';
            rs.disabled = true;
        }
        
        const re = document.getElementById('reqEmbosser');
        if (re) re.disabled = false;
        
        const em = document.getElementById('embosserMsg');
        if (em) em.style.display = 'none';
        
        showToast('Formulario limpiado');
    });

    // Product change: auto-set digits based on product type
    safeAddListener('reqProduct', 'change', () => {
        const isAdminNow = currentUser && currentUser.role === 'admin';
        const productEl = document.getElementById('reqProduct');
        if (!productEl) return;
        const product = productEl.value;
        const digitsSel = document.getElementById('reqDigits');
        const digitsMsg = document.getElementById('reqDigitsMsg');
        const segmentSel = document.getElementById('reqSegment');

        if (segmentSel) {
            if (product && PRODUCT_SEGMENTS[product]) {
                segmentSel.innerHTML = '<option value="">Seleccionar...</option>' + 
                    PRODUCT_SEGMENTS[product].map(s => `<option value="${s}">${s}</option>`).join('');
                segmentSel.disabled = false;
            } else {
                segmentSel.innerHTML = '<option value="">Primero seleccione Producto...</option>';
                segmentSel.disabled = true;
            }
        }

        if (digitsSel && digitsMsg) {
            const tokEl = document.getElementById('reqRequiereTokenizacion');
            const isTokenizado = tokEl && tokEl.value === 'Sí';
            
            if (isTokenizado) {
                digitsSel.value = '8';
                if (!isAdminNow) digitsSel.disabled = true;
                digitsMsg.style.display = 'block';
                digitsMsg.textContent = `🔐 BIN Tokenizado requiere 8 dígitos.` + (isAdminNow ? ' (el admin puede modificarlo)' : '');
            } else if (product === 'Prepago' || product === 'Débito') {
                digitsSel.value = '10';
                if (!isAdminNow) digitsSel.disabled = true;
                digitsMsg.style.display = 'block';
                digitsMsg.textContent = `⚠️ El producto ${product} requiere BIN de 10 dígitos.`
                    + (isAdminNow ? ' (el admin puede modificarlo)' : '');
            } else if (product === 'Crédito') {
                digitsSel.value = '9';
                if (!isAdminNow) digitsSel.disabled = true;
                digitsMsg.style.display = 'block';
                digitsMsg.textContent = '⚠️ El producto Crédito requiere BIN de 9 dígitos.'
                    + (isAdminNow ? ' (el admin puede modificarlo)' : '');
            } else {
                if (isAdminNow) digitsSel.disabled = false;
                digitsMsg.style.display = 'none';
            }
        }
    });

    // ===== Listener: requiere_tokenizacion =====
    safeAddListener('reqRequiereTokenizacion', 'change', function() {
        const val       = this.value;
        const tokMsg    = document.getElementById('reqTokenizadoMsg');

        if (val === 'Sí') {
            if (tokMsg) {
                tokMsg.style.display = 'block';
                tokMsg.textContent = '🔐 BIN Tokenizado: Se asignará a 8 dígitos.';
            }
        } else {
            if (tokMsg) tokMsg.style.display = 'none';
        }
        
        // Trigger product change to re-apply digit rules based on product
        const prod = document.getElementById('reqProduct');
        if (prod && prod.value) {
            const segEl = document.getElementById('reqSegment');
            const currentSeg = segEl ? segEl.value : null;
            prod.dispatchEvent(new Event('change'));
            if (segEl && currentSeg) {
                segEl.value = currentSeg;
            }
        }
    });

    // Add embosser buttons
    safeAddListener('addEmbosserBtn', 'click', () => addEmbosser('binEmbosser'));
    safeAddListener('reqAddEmbosserBtn', 'click', () => addEmbosser('reqEmbosser'));

    // Add country button in request form (admin only)
    safeAddListener('addCountryBtn', 'click', () => addCountry('binCountry'));
    safeAddListener('reqAddCountryBtn', 'click', () => addCountry('reqCountry'));

    // initFilters is now global and called in showApp()
    // Layout
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.querySelector('.main-content');
    if (sidebar) sidebar.classList.remove('collapsed');
    if (mainContent) mainContent.classList.remove('expanded');

    const savedToken = localStorage.getItem('binManagerToken');
    if (savedToken) {
        token = savedToken;
        fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${token}` } })
            .then(r => r.json())
            .then(data => {
                if (data.authenticated) {
                    currentUser = data.user;
                    showApp();
                } else {
                    localStorage.removeItem('binManagerToken');
                    showLogin();
                }
            })
            .catch(() => showLogin());
    } else {
        showLogin();
    }
});

function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

function updateFilterSummary() {
    // Count total active filter values
    let count = 0;
    const chips = [];

    const parentOnlyEl = document.getElementById('filterParentOnly');
    if (parentOnlyEl && parentOnlyEl.checked) {
        count++;
        chips.push({ key: '__parentOnly', label: 'Solo padres', value: '' });
    }

    Object.entries(activeFilters).forEach(([key, valSet]) => {
        if (!valSet || valSet.size === 0) return;
        valSet.forEach(val => {
            count++;
            let displayVal = val;
            if (key === 'status') displayVal = STATUS_LABELS[val] || val;
            chips.push({ key, label: FILTER_LABELS[key] || key, value: displayVal, rawVal: val });
        });
    });

    const search = document.getElementById('searchInput')?.value || '';
    if (search) { count++; chips.push({ key: '__search', label: 'BIN', value: search }); }

    // Badge on FILTROS button
    const badge = document.getElementById('activeFilterBadge');
    if (badge) {
        badge.textContent = count;
        if (count > 0) { badge.classList.remove('hidden'); badge.style.display = 'inline-block'; }
        else { badge.classList.add('hidden'); badge.style.display = 'none'; }
    }

    // Apply button text
    const applyBtn = document.getElementById('applyFiltersBtnPanel');
    if (applyBtn) applyBtn.textContent = count > 0 ? `APPLY ${count} FILTERS` : 'APPLY FILTERS';

    // Chips summary bar
    const summaryBar = document.getElementById('activeFiltersSummary');
    const chipsContainer = document.getElementById('filterChipsContainer');
    if (!summaryBar || !chipsContainer) return;

    if (chips.length === 0) {
        summaryBar.classList.add('hidden');
        chipsContainer.innerHTML = '';
        return;
    }
    summaryBar.classList.remove('hidden');
    chipsContainer.innerHTML = chips.map(chip => `
        <span class="filter-chip" data-key="${chip.key}" data-val="${chip.rawVal || ''}">
            <span class="chip-label">${chip.label}:</span>
            <span class="chip-value">${chip.value}</span>
            <button class="chip-remove" title="Quitar filtro">×</button>
        </span>`).join('');

    chipsContainer.querySelectorAll('.chip-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const chip = btn.closest('.filter-chip');
            const key = chip.dataset.key;
            const val = chip.dataset.val;
            if (key === '__parentOnly') {
                const el = document.getElementById('filterParentOnly');
                if (el) el.checked = false;
            } else if (key === '__search') {
                const el = document.getElementById('searchInput');
                if (el) el.value = '';
            } else {
                if (activeFilters[key]) activeFilters[key].delete(val);
                const msEl = document.querySelector(`.multiselect-dropdown[data-filter="${key}"]`);
                if (msEl && msEl._renderMs) msEl._renderMs();
            }
            loadBins();
            updateFilterSummary();
        });
    });
}

// Legacy alias
function updateFilterBadge() { updateFilterSummary(); }

window.restoreBin = async function(logId) {
    const isConfirmed = confirm('¿Está seguro de que desea restaurar este registro eliminado con todos sus datos originales?');
    if (isConfirmed) {
        try {
            const res = await api(`/api/audit/${logId}/restore`, { method: 'POST' });
            if (!res.ok) { const r = await res.json(); throw new Error(r.error); }
            alert('¡Registro restaurado exitosamente!');
            loadBins();
            loadAudit();
        } catch (e) {
            alert('Error al restaurar: ' + e.message);
        }
    }
};
