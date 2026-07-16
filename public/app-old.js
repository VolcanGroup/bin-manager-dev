// ========== BIN Manager v2 — Frontend App ==========
const isDev = window.location.hostname.includes('bin-manager-dev') || window.location.hostname.includes('localhost') || window.location.hostname.includes('127.0.0.1');
if (isDev) document.body.classList.add('is-dev');
document.title = isDev ? 'Dev Bin Manager' : 'Bin Manager';

let token = null;
let currentUser = null;
let currentSort = { column: 'bin_number', order: 'asc' };
let binsData = [];

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
    if (el) el.classList.add('active'); 
}
function closeModal(id) { 
    const el = document.getElementById(id);
    if (el) el.classList.remove('active'); 
}

function safeAddListener(id, event, callback) {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener(event, callback);
    }
}

// ========== Status Badge ==========
function statusBadge(status) {
    const map = {
        available: { label: 'Disponible', cls: 'badge-success' },
        segmented: { label: 'Segmentado', cls: 'badge-warning' },
        assigned: { label: 'Asignado', cls: 'badge-danger' },
        pending: { label: 'Por aprobar', cls: 'badge-pending' },
        exhausted: { label: 'Agotado', cls: 'badge-exhausted' },
        on_hold: { label: 'En Espera', cls: 'badge-hold' }
    };
    const s = map[status] || { label: status, cls: '' };
    return `<span class="badge ${s.cls}">${s.label}</span>`;
}

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

function showApp() {
    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('appPage').classList.remove('hidden');

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
        ['binEmbosser', 'reqEmbosser', 'filterEmbosser'].forEach(selectId => {
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

// ========== Dashboard ==========
async function loadDashboard() {
    try {
        const res = await api('/api/bins/stats');
        const stats = await res.json();

        // Length stats (Total)
        const lenMap = {};
        (stats.byLength || []).forEach(l => { lenMap[l.bin_length] = l.count; });
        document.getElementById('statLen8').textContent = lenMap[8] || 0;
        document.getElementById('statLen9').textContent = lenMap[9] || 0;
        document.getElementById('statLen10').textContent = lenMap[10] || 0;

        // Available by length
        const availMap = {};
        (stats.availableByLength || []).forEach(l => { availMap[l.bin_length] = l.count; });
        document.getElementById('statAvail8').textContent = availMap[8] || 0;
        document.getElementById('statAvail9').textContent = availMap[9] || 0;
        document.getElementById('statAvail10').textContent = availMap[10] || 0;

        // Clients table
        const cBody = document.getElementById('dashClientBody');
        cBody.innerHTML = (stats.byClient || []).map(c =>
            `<tr><td>${c.client}</td><td>${c.count}</td></tr>`
        ).join('') || '<tr><td colspan="2" style="text-align:center;color:var(--text-muted)">Sin clientes asignados</td></tr>';

        // Country matrix table
        const countryBody = document.getElementById('dashCountryBody');
        countryBody.innerHTML = (stats.countryMatrix || []).map(c =>
            `<tr>
                <td>${c.country}</td>
                <td>${c.len8}</td>
                <td>${c.len9}</td>
                <td>${c.len10}</td>
                <td style="color:var(--danger)">${c.assigned}</td>
                <td style="color:var(--success)">${c.available}</td>
            </tr>`
        ).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Sin datos por país</td></tr>';

        // Recent activity table
        const actBody = document.getElementById('dashActivityBody');
        actBody.innerHTML = (stats.recentActivity || []).map(a =>
            `<tr>
                <td><code>${a.bin_number}</code></td>
                <td>${a.client || '—'}</td>
                <td>${a.product || '—'}</td>
                <td>${a.bin_type || '—'}</td>
                <td>${a.bin_length}</td>
                <td>${a.updated_at ? new Date(a.updated_at).toLocaleString() : '—'}</td>
                <td>${statusBadge(a.status)}</td>
            </tr>`
        ).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">Sin actividad reciente</td></tr>';

        // Update pending badge
        updatePendingBadge();
    } catch (e) { console.error('Dashboard error:', e); }
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
async function loadBins() {
    try {
        const params = new URLSearchParams();
        const search = document.getElementById('searchInput').value;
        const status = document.getElementById('filterStatus').value;
        const brand = document.getElementById('filterBrand').value;
        const product = document.getElementById('filterProduct').value;
        const segment = document.getElementById('filterSegment') ? document.getElementById('filterSegment').value : '';
        const tokenization = document.getElementById('filterProcessor') ? document.getElementById('filterProcessor').value : '';
        const balanceType = document.getElementById('filterBalanceType') ? document.getElementById('filterBalanceType').value : '';
        const binType = document.getElementById('filterBinType').value;
        const binLen = document.getElementById('filterLength').value;
        const embosser = document.getElementById('filterEmbosser').value;
        const parentOnly = document.getElementById('filterParentOnly').checked;

        if (search) params.set('search', search);
        if (status) params.set('status', status);
        if (brand) params.set('brand', brand);
        if (product) params.set('product', product);
        if (segment) params.set('segment', segment);
        if (tokenization) params.set('tokenization', tokenization);
        if (balanceType) params.set('balance_type', balanceType);
        if (binType) params.set('bin_type', binType);
        if (binLen) params.set('bin_length', binLen);
        if (embosser) params.set('embosser', embosser);
        if (parentOnly) params.set('parent_only', 'true');
        params.set('sort', currentSort.column);
        params.set('order', currentSort.order);

        const res = await api(`/api/bins?${params}`);
        binsData = await res.json();
        renderBinsTable(binsData);
    } catch (e) { console.error('Load bins error:', e); }
}

function renderBinsTable(bins) {
    const isAdmin = currentUser && currentUser.role === 'admin';
    const body = document.getElementById('binsTableBody');
    const colCount = isAdmin ? 15 : 14;
    document.getElementById('binsCount').textContent = `${bins.length} BINes`;

    if (bins.length === 0) {
        body.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;padding:40px;color:var(--text-muted)">No se encontraron BINes</td></tr>`;
        return;
    }

    body.innerHTML = bins.map(bin => {
        const segInfo = bin.total_segments ? ` <span class="seg-badge" onclick="viewSegments('${bin.bin_number}')" title="${bin.available_segments} disponibles de ${bin.total_segments}">📊 ${bin.available_segments}/${bin.total_segments}</span>` : '';
        // Show Regresar a BIN 8 button for admin on any segmented parent BIN where ALL segments are still available
        const allAvailable = bin.total_segments > 0 && bin.available_segments === bin.total_segments;
        const canUnsegment = isAdmin && bin.status === 'segmented' && bin.parent_bin === null && allAvailable;
        const unsegBtn = canUnsegment ? `<button class="btn-icon" onclick="unsegmentBin(${bin.id}, '${bin.bin_number}')" title="Regresar a BIN 8">↩️</button>` : '';
        // Show hold button for admin on available/assigned/pending BINs
        const canHold = isAdmin && !['segmented', 'exhausted', 'on_hold'].includes(bin.status) && bin.parent_bin === null;
        const holdBtn = canHold ? `<button class="btn-icon" onclick="holdBin(${bin.id}, '${bin.bin_number}')" title="Poner En Espera">⏸️</button>` : '';
        return `<tr>
            <td>${bin.country || '—'}</td>
            <td>${bin.ica || '—'}</td>
            <td>${bin.ica_qmr || '—'}</td>
            <td><code>${bin.bin_number}</code>${segInfo}</td>
            <td>${bin.bin_length}</td>
            <td>${bin.brand ? `<span class="brand-badge brand-${bin.brand.toLowerCase()}">${bin.brand}</span>` : '—'}</td>
            <td>${bin.product || '—'}</td>
            <td>${bin.segment || '—'}</td>
            <td>${statusBadge(bin.status)}</td>
            <td>${bin.client || '—'}</td>
            <td>${bin.tokenization || '—'}</td>
            <td>${bin.bin_type || '—'}</td>
            <td>${bin.embosser || '—'}</td>
            <td>${bin.balance_type || '—'}</td>
            ${isAdmin ? `<td class="actions-cell">
                <button class="btn-icon" onclick="editBin(${bin.id})" title="Editar">✏️</button>
                ${bin.status === 'available' && !bin.parent_bin ? `<button class="btn-icon" onclick="assignBin(${bin.id})" title="Asignar">🔒</button>` : ''}
                ${bin.status === 'assigned' ? `<button class="btn-icon" onclick="releaseBin(${bin.id})" title="Liberar">🔓</button>` : ''}
                ${holdBtn}
                ${unsegBtn}
                <button class="btn-icon" onclick="deleteBin(${bin.id})" title="Eliminar">🗑️</button>
            </td>` : ''}
        </tr>`;
    }).join('');
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
                    <td>${s.tokenization || '—'}</td>
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
        document.getElementById('binTokenization').value = bin.tokenization || '';
        document.getElementById('binKeys').value = bin.keys || '';
        document.getElementById('binEmbosser').value = bin.embosser || '';
        document.getElementById('binType').value = bin.bin_type || '';
        document.getElementById('binBalanceType').value = bin.balance_type || '';
        document.getElementById('binStatus').value = bin.status || 'available';
        document.getElementById('binNotes').value = bin.notes || '';
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
        client: document.getElementById('binClient').value,
        tokenization: document.getElementById('binTokenization').value,
        keys: document.getElementById('binKeys').value,
        embosser: document.getElementById('binEmbosser').value,
        bin_type: document.getElementById('binType').value,
        balance_type: document.getElementById('binBalanceType').value,
        status: document.getElementById('binStatus').value,
        notes: document.getElementById('binNotes').value
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

    if (!parentBin) { showToast('Ingrese el BIN padre', 'error'); return; }

    try {
        const res = await api('/api/bins/segment', {
            method: 'POST',
            body: JSON.stringify({ parent_bin_number: parentBin, target_length: targetLength })
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
        tokenization: document.getElementById('reqTokenization').value,
        keys: document.getElementById('reqKeys').value,
        embosser: embosserValue,
        balance_type: document.getElementById('reqBalanceType').value
    };

    // Frontend validation
    if (!data.country) { showToast('Seleccione un país', 'error'); return; }
    if (!data.digits) { showToast('Seleccione los dígitos', 'error'); return; }
    if (parseInt(data.digits) === 8 && !isAdmin) { showToast('Solo el administrador puede solicitar BINes de 8 dígitos', 'error'); return; }
    if (!data.brand) { showToast('Seleccione la marca', 'error'); return; }
    if (!data.product) { showToast('Seleccione el producto', 'error'); return; }
    if (!data.segment) { showToast('Seleccione el segmento', 'error'); return; }
    if (!data.bin_type) { showToast('Seleccione el tipo de BIN', 'error'); return; }
    if (!data.client) { showToast('El cliente es requerido', 'error'); return; }
    if (!data.tokenization) { showToast('Seleccione la tokenización', 'error'); return; }
    if (!data.keys) { showToast('Seleccione el tipo de llaves', 'error'); return; }
    if (!data.embosser) { showToast('Seleccione el embozador', 'error'); return; }
    if (!data.balance_type) { showToast('Seleccione el tipo de saldos', 'error'); return; }

    try {
        const res = await api('/api/requests', { method: 'POST', body: JSON.stringify(data) });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
        showToast(`Solicitud creada. BIN propuesto: ${result.proposed_bin}`);
        document.getElementById('requestForm').reset();
        // Reset UI state
        const embosserSel = document.getElementById('reqEmbosser');
        embosserSel.disabled = false;
        document.getElementById('embosserMsg').style.display = 'none';
        document.getElementById('reqDigitsMsg').style.display = 'none';
        document.getElementById('reqDigits').disabled = false;
        document.getElementById('reqSegment').innerHTML = '<option value="">Primero seleccione Producto...</option>';
        document.getElementById('reqSegment').disabled = true;
        navigateTo('myRequests');
    } catch (e) { showToast(e.message, 'error'); }
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
                <td>${requestStatusBadge(r.status)}</td>
                <td>${r.admin_username || '—'}</td>
            </tr>`
        ).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:40px">Sin solicitudes</td></tr>';
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
                <td>${requestStatusBadge(r.status)}</td>
                <td class="actions-cell">
                    ${r.status === 'pending' ? `
                        <button class="btn btn-sm btn-success" onclick="approveRequest(${r.id})">✅ Aprobar</button>
                        <button class="btn btn-sm btn-danger" onclick="rejectRequest(${r.id})">❌ Rechazar</button>
                    ` : `<span style="color:var(--text-muted);font-size:0.8rem">${r.admin_username || ''} — ${r.admin_action_date ? new Date(r.admin_action_date).toLocaleDateString('es') : ''}</span>`}
                </td>
            </tr>`
        ).join('') || '<tr><td colspan="11" style="text-align:center;color:var(--text-muted);padding:40px">Sin solicitudes</td></tr>';
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

// ========== Users ==========
async function loadUsers() {
    try {
        const res = await api('/api/users');
        const users = await res.json();
        const grid = document.getElementById('usersGrid');
        const roleLabels = { admin: 'Administrador', viewer: 'Solo Lectura', requester: 'Solicitante' };
        const roleIcons = { admin: '👑', viewer: '👁️', requester: '📝' };
        grid.innerHTML = users.map(u =>
            `<div class="user-card">
                <div class="user-card-avatar">${(u.full_name || u.username).charAt(0).toUpperCase()}</div>
                <div class="user-card-info">
                    <div class="user-card-name">${u.full_name || u.username}</div>
                    <div class="user-card-role">${roleIcons[u.role] || ''} ${roleLabels[u.role] || u.role}</div>
                    <div class="user-card-meta">@${u.username}</div>
                </div>
                <div class="user-card-actions">
                    <button class="btn-icon" onclick="editUser(${u.id})" title="Editar">✏️</button>
                    ${u.id !== currentUser.id ? `<button class="btn-icon" onclick="deleteUser(${u.id}, '${u.username}')" title="Eliminar">🗑️</button>` : ''}
                </div>
            </div>`
        ).join('');
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
                <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${l.details || '—'}</td>
            </tr>`
        ).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:40px">Sin registros</td></tr>';
    } catch (e) { console.error('Audit error:', e); }
}

// ========== Export TXT (CSV) ==========
function exportBins() {
    if (!binsData || binsData.length === 0) {
        showToast('No hay datos para exportar', 'warning');
        return;
    }
    // We export only the data currently shown, matching headers
    downloadAsCSV(binsData, 'bines_export.txt');
    showToast('Archivo TXT exportado correctamente');
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

    // Filters
    ['searchInput', 'filterStatus', 'filterBrand', 'filterProduct', 'filterSegment', 'filterProcessor', 'filterEmbosser', 'filterBalanceType', 'filterBinType', 'filterLength'].forEach(id => {
        safeAddListener(id, 'change', loadBins);
    });
    safeAddListener('searchInput', 'input', debounce(loadBins, 300));
    safeAddListener('filterParentOnly', 'change', loadBins);

    // Sort headers
    document.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.sort;
            if (currentSort.column === col) {
                currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort = { column: col, order: 'asc' };
            }
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

    // Export and Delete All
    safeAddListener('exportBinsBtn', 'click', exportBins);
    safeAddListener('deleteAllBinsBtn', 'click', deleteAllBins);

    // Clear Filters
    safeAddListener('clearFiltersBtn', 'click', () => {
        ['searchInput', 'filterStatus', 'filterBrand', 'filterProduct', 'filterSegment', 'filterProcessor', 'filterEmbosser', 'filterBalanceType', 'filterBinType', 'filterLength'].forEach(id => {
            if (document.getElementById(id)) document.getElementById(id).value = '';
        });
        // Logic to reset segment filter to global state instead of disabling it
        const filterSeg = document.getElementById('filterSegment');
        if (filterSeg) {
            const allSegments = [...new Set(Object.values(PRODUCT_SEGMENTS).flat())].sort();
            filterSeg.innerHTML = '<option value="">Todos los segmentos</option>' + 
                allSegments.map(s => `<option value="${s}">${s}</option>`).join('');
            filterSeg.disabled = false;
        }
        if (document.getElementById('filterParentOnly')) document.getElementById('filterParentOnly').checked = false;
        loadBins();
    });

    // Clear Request Form
    safeAddListener('clearRequestFormBtn', 'click', () => {
        const isAdminClear = currentUser && currentUser.role === 'admin';
        const fields = ['reqCountry', 'reqDigits', 'reqBrand', 'reqProduct', 'reqBinType', 'reqClient', 'reqTokenization', 'reqKeys', 'reqEmbosser', 'reqBalanceType'];
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
            if (product === 'Prepago' || product === 'D\u00e9bito') {
                digitsSel.value = '10';
                if (!isAdminNow) digitsSel.disabled = true;
                digitsMsg.style.display = 'block';
                digitsMsg.textContent = `\u26a0\ufe0f El producto ${product} requiere BIN de 10 d\u00edgitos.`
                    + (isAdminNow ? ' (el admin puede modificarlo)' : '');
            } else if (product === 'Cr\u00e9dito') {
                digitsSel.value = '9';
                if (!isAdminNow) digitsSel.disabled = true;
                digitsMsg.style.display = 'block';
                digitsMsg.textContent = '\u26a0\ufe0f El producto Cr\u00e9dito requiere BIN de 9 d\u00edgitos.'
                    + (isAdminNow ? ' (el admin puede modificarlo)' : '');
            } else {
                if (isAdminNow) digitsSel.disabled = false;
                digitsMsg.style.display = 'none';
            }
        }
    });

    const filterProductSel = document.getElementById('filterProduct');
    if (filterProductSel) {
        filterProductSel.addEventListener('change', (e) => {
            const product = e.target.value;
            const filterSeg = document.getElementById('filterSegment');
            if (filterSeg) {
                if (product && PRODUCT_SEGMENTS[product]) {
                    filterSeg.innerHTML = '<option value="">Todos los segmentos</option>' + 
                        PRODUCT_SEGMENTS[product].map(s => `<option value="${s}">${s}</option>`).join('');
                } else {
                    // Show ALL segments from ALL products when no specific product is selected
                    const allSegments = [...new Set(Object.values(PRODUCT_SEGMENTS).flat())].sort();
                    filterSeg.innerHTML = '<option value="">Todos los segmentos</option>' + 
                        allSegments.map(s => `<option value="${s}">${s}</option>`).join('');
                }
                filterSeg.disabled = false;
            }
            loadBins();
        });
    }

    // Add embosser buttons
    safeAddListener('addEmbosserBtn', 'click', () => addEmbosser('binEmbosser'));
    safeAddListener('reqAddEmbosserBtn', 'click', () => addEmbosser('reqEmbosser'));

    // Add country button in request form (admin only)
    safeAddListener('addCountryBtn', 'click', () => addCountry('binCountry'));
    safeAddListener('reqAddCountryBtn', 'click', () => addCountry('reqCountry'));

    // Auto-login or initial setup
    const initFilters = () => {
        const filterSeg = document.getElementById('filterSegment');
        if (filterSeg) {
            const allSegments = [...new Set(Object.values(PRODUCT_SEGMENTS).flat())].sort();
            filterSeg.innerHTML = '<option value="">Todos los segmentos</option>' + 
                allSegments.map(s => `<option value="${s}">${s}</option>`).join('');
            filterSeg.disabled = false;
        }
    };
    initFilters();

    // UI Enhancements: Sidebar Toggle & Dark Mode
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.querySelector('.main-content');
    const toggleBtn = document.getElementById('toggleSidebar');
    const themeBtn = document.getElementById('themeToggle');
    const themeIcon = themeBtn ? themeBtn.querySelector('.theme-icon') : null;
    const themeText = themeBtn ? themeBtn.querySelector('.nav-text') : null;

    const toggleSidebar = (force) => {
        const isCollapsed = force !== undefined ? force : sidebar.classList.toggle('collapsed');
        if (force !== undefined) sidebar.classList.toggle('collapsed', force);
        if (mainContent) mainContent.classList.toggle('expanded', isCollapsed);
        localStorage.setItem('sidebarCollapsed', isCollapsed);
    };

    const setTheme = (theme) => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        if (themeIcon && themeText) {
            themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
            themeText.textContent = theme === 'dark' ? 'Modo Claro' : 'Modo Oscuro';
        }
    };

    if (toggleBtn) toggleBtn.onclick = () => toggleSidebar();
    if (themeBtn) themeBtn.onclick = () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    };

    // Load saved preferences
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);
    if (localStorage.getItem('sidebarCollapsed') === 'true') toggleSidebar(true);

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
