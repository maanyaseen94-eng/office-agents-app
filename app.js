// app.js — منطق الواجهة الأمامية (SPA بسيط بدون أطر عمل خارجية)

const state = {
  me: null,
  view: 'home',
  agentsCache: [],
  staffCache: [],
  officesCache: [],
  reportSubTab: 'general'
};

// ---------------- أدوات مساعدة ----------------
function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => { el.className = 'toast'; }, 2600);
}

async function api(path, { method = 'GET', body, isForm = false } = {}) {
  const opts = { method, headers: {} };
  if (body && !isForm) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body && isForm) {
    opts.body = body; // FormData
  }
  const res = await fetch('/api' + path, opts);
  let data = {};
  try { data = await res.json(); } catch (e) { /* ignore */ }
  if (!res.ok) throw new Error(data.error || 'حدث خطأ غير متوقع');
  return data;
}

function fmtDate(d) {
  if (!d) return '—';
  return d;
}

function initials(name) {
  if (!name) return '؟';
  const parts = name.trim().split(/\s+/);
  return parts[0][0] || '؟';
}

function avatarHtml(photo, name, size = 46) {
  if (photo) {
    return `<img src="${photo}" class="avatar" style="width:${size}px;height:${size}px">`;
  }
  return `<div class="avatar" style="width:${size}px;height:${size}px">${initials(name)}</div>`;
}

function statusBadge(status) {
  if (status === 'منجز') return `<span class="badge badge-done">منجز</span>`;
  if (status === 'مرفوض') return `<span class="badge badge-rejected">مرفوض</span>`;
  return `<span class="badge badge-pending">قيد الانجاز</span>`;
}

function roleLabel(role) {
  return { admin: 'مسؤول رئيسي', agent: 'مخوّل', staff: 'موظف متابعة', viewer: 'اطلاع فقط' }[role] || role;
}

function isPersonAssignable(role) { return role === 'agent' || role === 'staff'; }

function taskTypeLabel(t) {
  if (t.task_type === 'متابعة_بريد') return 'متابعة مخول';
  if (t.task_type === 'عاجلة') return 'مهمة عاجلة';
  return 'مهمة عادية';
}
function isUrgentTask(t) { return t.task_type === 'عاجلة'; }
function taskTargetLabel(t) {
  if (t.task_type !== 'متابعة_بريد') return '';
  if (t.target_type === 'مخول') return 'متابعة المخوّل: ' + (t.target_agent_name || '');
  if (t.target_type === 'مكتب') return 'متابعة مكتب: ' + (t.target_office || '');
  return '';
}

// ---------------- نوافذ منبثقة ----------------
function openModal(html) {
  $('#modalBox').innerHTML = html;
  $('#modalOverlay').classList.remove('hidden');
}
function closeModal() {
  $('#modalOverlay').classList.add('hidden');
  $('#modalBox').innerHTML = '';
}
$('#modalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'modalOverlay') closeModal();
});

// ---------------- تسجيل الدخول / الخروج ----------------
async function checkSession() {
  try {
    const { user } = await api('/me');
    state.me = user;
    showApp();
  } catch (e) {
    showLogin();
  }
}

function showLogin() {
  $('#loginScreen').classList.remove('hidden');
  $('#appScreen').classList.add('hidden');
}

function showApp() {
  $('#loginScreen').classList.add('hidden');
  $('#appScreen').classList.remove('hidden');
  $('#meName').textContent = `${state.me.full_name} (${roleLabel(state.me.role)})`;
  applyRoleVisibility();
  setView('home');
}

function applyRoleVisibility() {
  $all('.admin-only').forEach(el => {
    el.style.display = state.me.role === 'admin' ? '' : 'none';
  });
  $all('.report-tab-btn').forEach(el => {}); // placeholder
  const reportsTab = $('.tab-btn[data-view="reports"]');
  if (reportsTab) reportsTab.style.display = (state.me.role === 'admin' || state.me.role === 'viewer') ? '' : 'none';
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginError').textContent = '';
  const username = $('#loginUsername').value.trim();
  const password = $('#loginPassword').value;
  try {
    const { user } = await api('/login', { method: 'POST', body: { username, password } });
    state.me = user;
    showApp();
  } catch (err) {
    $('#loginError').textContent = err.message;
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' });
  state.me = null;
  location.reload();
});

$('#changePasswordBtn').addEventListener('click', () => openChangePasswordModal());
function openChangePasswordModal() {
  openModal(`
    <h2>تغيير كلمة المرور</h2>
    <form id="changePasswordForm">
      <div class="form-grid">
        <div class="form-group full"><label>كلمة المرور الحالية</label><input type="password" name="current_password" required autocomplete="current-password"></div>
        <div class="form-group full"><label>كلمة المرور الجديدة</label><input type="password" name="new_password" required minlength="4" autocomplete="new-password"></div>
        <div class="form-group full"><label>تأكيد كلمة المرور الجديدة</label><input type="password" name="confirm_password" required minlength="4" autocomplete="new-password"></div>
      </div>
      <div id="changePasswordError" class="error-text"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost-dark" onclick="closeModal()">إلغاء</button>
        <button type="submit" class="btn btn-primary">حفظ</button>
      </div>
    </form>
  `);
  $('#changePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const currentPassword = fd.get('current_password');
    const newPassword = fd.get('new_password');
    const confirmPassword = fd.get('confirm_password');
    if (newPassword !== confirmPassword) {
      $('#changePasswordError').textContent = 'كلمة المرور الجديدة وتأكيدها غير متطابقين';
      return;
    }
    try {
      await api('/change-password', { method: 'POST', body: { currentPassword, newPassword } });
      toast('تم تغيير كلمة المرور بنجاح');
      closeModal();
    } catch (err) {
      $('#changePasswordError').textContent = err.message;
    }
  });
}

// ---------------- التنقل بين الأقسام ----------------
$all('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

function setView(view) {
  state.view = view;
  $all('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  const renderers = {
    home: renderHome,
    agents: renderAgents,
    offices: renderOffices,
    tasks: renderTasks,
    overdue: renderOverdue,
    reports: renderReports,
    accounts: renderAccounts
  };
  (renderers[view] || renderHome)();
}

// ================= الرئيسية =================
async function renderHome() {
  const main = $('#mainContent');
  main.innerHTML = `<div class="section-header"><h2>لوحة المتابعة</h2></div><div id="statsArea">جارِ التحميل...</div>`;
  try {
    const stats = await api('/stats');
    $('#statsArea').innerHTML = `
      <div class="dash-grid">
        <div class="dash-card" data-nav="agents">
          <div class="icon">👥</div>
          <div class="num">${stats.agentsCount}</div>
          <div class="label">المخولين</div>
        </div>
        <div class="dash-card" data-nav="tasks">
          <div class="icon">📋</div>
          <div class="num">${stats.tasksCount}</div>
          <div class="label">الطلبات</div>
        </div>
        <div class="dash-card alert" data-nav="overdue">
          <div class="icon">⏰</div>
          <div class="num">${stats.overdueCount}</div>
          <div class="label">المتأخرة</div>
        </div>
      </div>
      <div class="dash-grid">
        <div class="dash-card"><div class="icon">🕓</div><div class="num">${stats.pendingCount}</div><div class="label">قيد الانجاز</div></div>
        <div class="dash-card"><div class="icon">✅</div><div class="num">${stats.doneCount}</div><div class="label">منجزة</div></div>
        <div class="dash-card"><div class="icon">🚫</div><div class="num">${stats.rejectedCount}</div><div class="label">مرفوضة</div></div>
      </div>
      ${state.me.role === 'admin' ? `<div style="text-align:center;margin-top:10px"><button class="btn btn-primary" id="quickAddTaskBtn">＋ إضافة مهمة</button></div>` : ''}
    `;
    $all('[data-nav]').forEach(el => el.addEventListener('click', () => setView(el.dataset.nav)));
    const quickBtn = $('#quickAddTaskBtn');
    if (quickBtn) quickBtn.addEventListener('click', openCreateTaskModal);
  } catch (e) {
    $('#statsArea').innerHTML = `<div class="empty-state">تعذر تحميل البيانات</div>`;
  }
}

// ================= المخولين =================
async function loadAgents() {
  const { agents } = await api('/agents');
  state.agentsCache = agents;
  return agents;
}

async function loadStaff() {
  const { staff } = await api('/staff');
  state.staffCache = staff;
  return staff;
}

async function loadOffices() {
  const { offices } = await api('/offices');
  state.officesCache = offices;
  return offices;
}

async function renderAgents() {
  const main = $('#mainContent');
  main.innerHTML = `
    <div class="section-header">
      <h2>المخولين</h2>
      <button class="btn btn-primary btn-sm admin-only" id="addAgentBtn">＋ إضافة مخوّل</button>
    </div>
    <div id="agentsList" class="card-list">جارِ التحميل...</div>
  `;
  applyRoleVisibility();
  const addBtn = $('#addAgentBtn');
  if (addBtn) addBtn.addEventListener('click', () => openAgentForm());

  try {
    const agents = await loadAgents();
    const list = $('#agentsList');
    if (!agents.length) {
      list.innerHTML = `<div class="empty-state"><div class="icon">👥</div>لا يوجد مخولون بعد</div>`;
      return;
    }
    list.innerHTML = agents.map(a => `
      <div class="item-card" data-id="${a.id}">
        ${avatarHtml(a.photo, a.full_name)}
        <div class="item-body">
          <div class="item-title">${escapeHtml(a.full_name)}</div>
          <div class="item-sub">${escapeHtml(a.username)} ${a.phone ? '· ' + escapeHtml(a.phone) : ''}</div>
        </div>
        <span class="badge badge-role">${roleLabel(a.role)}</span>
      </div>
    `).join('');
    $all('#agentsList .item-card').forEach(card => {
      card.addEventListener('click', () => openAgentProfile(Number(card.dataset.id)));
    });
  } catch (e) {
    $('#agentsList').innerHTML = `<div class="empty-state">تعذر تحميل قائمة المخولين</div>`;
  }
}

function openAgentProfile(id) {
  const agent = state.agentsCache.find(a => a.id === id);
  if (!agent) return;
  openModal(`
    <div class="modal-close-row"><button class="btn btn-ghost-dark btn-sm" onclick="closeModal()">إغلاق</button></div>
    <div style="text-align:center;margin-bottom:14px">
      ${avatarHtml(agent.photo, agent.full_name, 90)}
      <h2 style="margin-bottom:2px">${escapeHtml(agent.full_name)}</h2>
      <div class="muted">${escapeHtml(agent.username)} ${agent.phone ? '· ' + escapeHtml(agent.phone) : ''}</div>
    </div>
    <div class="form-actions" style="justify-content:center">
      <button class="btn btn-secondary" id="viewAgentReportBtn">عرض تقرير هذا المخول</button>
      <button class="btn btn-ghost-dark admin-only" id="editAgentBtn">تعديل البيانات</button>
    </div>
  `);
  applyRoleVisibility();
  $('#viewAgentReportBtn').addEventListener('click', () => {
    closeModal();
    setView('reports');
    setTimeout(() => selectAgentReport(id), 50);
  });
  const editBtn = $('#editAgentBtn');
  if (editBtn) editBtn.addEventListener('click', () => openAgentForm(agent));
}

function openAgentForm(agent = null) {
  const isEdit = Boolean(agent);
  openModal(`
    <h2>${isEdit ? 'تعديل بيانات مخوّل' : 'إضافة مخوّل جديد'}</h2>
    <form id="agentForm">
      <div class="form-grid">
        <div class="form-group full">
          <label>صورة المخوّل</label>
          <input type="file" name="photo" accept="image/*">
        </div>
        <div class="form-group">
          <label>الاسم الكامل</label>
          <input type="text" name="full_name" required value="${isEdit ? escapeAttr(agent.full_name) : ''}">
        </div>
        <div class="form-group">
          <label>رقم الهاتف</label>
          <input type="text" name="phone" value="${isEdit ? escapeAttr(agent.phone || '') : ''}">
        </div>
        ${!isEdit ? `
        <div class="form-group">
          <label>اسم المستخدم</label>
          <input type="text" name="username" required>
        </div>
        <div class="form-group">
          <label>كلمة المرور</label>
          <input type="password" name="password" required>
        </div>` : `
        <div class="form-group">
          <label>كلمة مرور جديدة (اختياري)</label>
          <input type="password" name="password" placeholder="اتركه فارغاً لعدم التغيير">
        </div>
        <div class="form-group">
          <label>الحالة</label>
          <select name="active">
            <option value="true" ${agent.active ? 'selected' : ''}>فعّال</option>
            <option value="false" ${!agent.active ? 'selected' : ''}>معطّل</option>
          </select>
        </div>`}
      </div>
      <div id="agentFormError" class="error-text"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost-dark" onclick="closeModal()">إلغاء</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'حفظ التعديلات' : 'إضافة'}</button>
      </div>
    </form>
  `);

  $('#agentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (!isEdit) fd.append('role', 'agent');
    try {
      if (isEdit) {
        await api(`/users/${agent.id}`, { method: 'PUT', body: fd, isForm: true });
      } else {
        await api('/users', { method: 'POST', body: fd, isForm: true });
      }
      toast('تم الحفظ بنجاح');
      closeModal();
      renderAgents();
    } catch (err) {
      $('#agentFormError').textContent = err.message;
    }
  });
}

// ================= المكاتب =================
async function renderOffices() {
  const main = $('#mainContent');
  main.innerHTML = `
    <div class="section-header">
      <h2>المكاتب</h2>
      <button class="btn btn-primary btn-sm admin-only" id="addOfficeBtn">＋ إضافة مكتب</button>
    </div>
    <div id="officesList" class="card-list">جارِ التحميل...</div>
  `;
  applyRoleVisibility();
  const addBtn = $('#addOfficeBtn');
  if (addBtn) addBtn.addEventListener('click', () => openOfficeForm());

  try {
    const offices = await loadOffices();
    const list = $('#officesList');
    if (!offices.length) {
      list.innerHTML = `<div class="empty-state"><div class="icon">🏢</div>لا توجد مكاتب مضافة بعد</div>`;
      return;
    }
    list.innerHTML = offices.map(o => `
      <div class="item-card" data-id="${o.id}">
        <div class="avatar">🏢</div>
        <div class="item-body">
          <div class="item-title">${escapeHtml(o.name)} ${!o.active ? '<span class="badge badge-rejected">معطّل</span>' : ''}</div>
        </div>
      </div>
    `).join('');
    $all('#officesList .item-card').forEach(card => {
      card.addEventListener('click', () => {
        if (state.me.role !== 'admin') return;
        const o = offices.find(x => x.id === Number(card.dataset.id));
        openOfficeForm(o);
      });
    });
  } catch (e) {
    $('#officesList').innerHTML = `<div class="empty-state">تعذر تحميل المكاتب</div>`;
  }
}

function openOfficeForm(office = null) {
  const isEdit = Boolean(office);
  openModal(`
    <h2>${isEdit ? 'تعديل بيانات مكتب' : 'إضافة مكتب جديد'}</h2>
    <form id="officeForm">
      <div class="form-grid">
        <div class="form-group full"><label>اسم المكتب</label><input type="text" name="name" required value="${isEdit ? escapeAttr(office.name) : ''}"></div>
        ${isEdit ? `<div class="form-group"><label>الحالة</label><select name="active"><option value="true" ${office.active ? 'selected' : ''}>فعّال</option><option value="false" ${!office.active ? 'selected' : ''}>معطّل</option></select></div>` : ''}
      </div>
      <div id="officeFormError" class="error-text"></div>
      <div class="form-actions">
        ${isEdit ? `<button type="button" class="btn btn-danger" id="deleteOfficeBtn">حذف المكتب</button>` : ''}
        <button type="button" class="btn btn-ghost-dark" onclick="closeModal()">إلغاء</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'حفظ التعديلات' : 'إضافة'}</button>
      </div>
    </form>
  `);
  $('#officeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      if (isEdit) {
        await api(`/offices/${office.id}`, { method: 'PUT', body: { name: fd.get('name'), active: fd.get('active') }, isForm: false });
      } else {
        await api('/offices', { method: 'POST', body: { name: fd.get('name') }, isForm: false });
      }
      toast('تم الحفظ بنجاح');
      closeModal();
      renderOffices();
    } catch (err) {
      $('#officeFormError').textContent = err.message;
    }
  });
  const delBtn = $('#deleteOfficeBtn');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (!confirm('هل أنت متأكد من حذف هذا المكتب؟')) return;
    try {
      await api(`/offices/${office.id}`, { method: 'DELETE' });
      toast('تم الحذف');
      closeModal();
      renderOffices();
    } catch (err) {
      $('#officeFormError').textContent = err.message;
    }
  });
}

// ================= الطلبات (المهام) =================
let taskFilters = { status: '', assigned_to: '', office: '' };

async function renderTasks(overdueOnly = false) {
  const main = $('#mainContent');
  const showAssignFilter = state.me.role !== 'agent' && state.me.role !== 'staff';
  if (showAssignFilter && state.agentsCache.length === 0) { try { await loadAgents(); } catch (e) {} }
  if (showAssignFilter && state.staffCache.length === 0) { try { await loadStaff(); } catch (e) {} }
  const assignable = [...state.agentsCache, ...state.staffCache];
  const assignOptions = assignable.map(a => `<option value="${a.id}">${escapeHtml(a.full_name)} (${roleLabel(a.role)})</option>`).join('');
  const typeOptions = `<option value="">كل الأنواع</option><option value="عادية">مهام عادية</option><option value="عاجلة">مهام عاجلة</option>${state.me.role === 'agent' ? '' : '<option value="متابعة_بريد">متابعة مخول</option>'}`;

  main.innerHTML = `
    <div class="section-header">
      <h2>${overdueOnly ? 'المهام المتأخرة' : 'الطلبات / المهام'}</h2>
      <button class="btn btn-primary btn-sm admin-only" id="addTaskBtn">＋ إضافة مهمة</button>
    </div>
    <div class="filters-bar">
      <select id="filterStatus">
        <option value="">كل الحالات</option>
        <option value="قيد الانجاز">قيد الانجاز</option>
        <option value="منجز">منجز</option>
        <option value="مرفوض">مرفوض</option>
      </select>
      ${showAssignFilter ? `<select id="filterAgent"><option value="">الكل (مخولين وموظفين)</option>${assignOptions}</select>` : ''}
      <select id="filterType">${typeOptions}</select>
      <input type="text" id="filterOffice" placeholder="بحث باسم المكتب...">
    </div>
    <div id="tasksList" class="card-list">جارِ التحميل...</div>
  `;
  applyRoleVisibility();

  const addBtn = $('#addTaskBtn');
  if (addBtn) addBtn.addEventListener('click', openCreateTaskModal);

  $('#filterStatus').addEventListener('change', () => loadTasksList(overdueOnly));
  $('#filterType').addEventListener('change', () => loadTasksList(overdueOnly));
  const filterAgentEl = $('#filterAgent');
  if (filterAgentEl) filterAgentEl.addEventListener('change', () => loadTasksList(overdueOnly));
  let debounce;
  $('#filterOffice').addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => loadTasksList(overdueOnly), 350);
  });

  await loadTasksList(overdueOnly);
}

function renderOverdue() { return renderTasks(true); }

async function loadTasksList(overdueOnly) {
  const params = new URLSearchParams();
  const status = $('#filterStatus') ? $('#filterStatus').value : '';
  const agentSel = $('#filterAgent');
  const typeSel = $('#filterType');
  const office = $('#filterOffice') ? $('#filterOffice').value : '';
  if (status) params.set('status', status);
  if (agentSel && agentSel.value) params.set('assigned_to', agentSel.value);
  if (typeSel && typeSel.value) params.set('task_type', typeSel.value);
  if (office) params.set('office', office);
  if (overdueOnly) params.set('overdue', 'true');

  const list = $('#tasksList');
  try {
    const { tasks } = await api('/tasks?' + params.toString());
    if (!tasks.length) {
      list.innerHTML = `<div class="empty-state"><div class="icon">📭</div>لا توجد مهام مطابقة</div>`;
      return;
    }
    list.innerHTML = tasks.map(t => `
      <div class="item-card" data-id="${t.id}">
        ${avatarHtml(t.assignee_photo, t.assignee_name)}
        <div class="item-body">
          <div class="item-title">${escapeHtml(t.title)} ${t.task_type === 'متابعة_بريد' ? '<span class="badge badge-role">📮 متابعة مخول</span>' : ''} ${isUrgentTask(t) ? '<span class="badge badge-urgent">⚡ عاجلة</span>' : ''}</div>
          <div class="item-sub">${escapeHtml(t.office_name)} · ${escapeHtml(t.assignee_name)} (${roleLabel(t.task_type === 'متابعة_بريد' ? 'staff' : 'agent')}) · استحقاق: ${fmtDate(t.due_date)}</div>
          ${t.task_type === 'متابعة_بريد' ? `<div class="item-sub">${escapeHtml(taskTargetLabel(t))}</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
          ${statusBadge(t.status)}
          ${t.overdue ? '<span class="badge badge-overdue">متأخرة</span>' : ''}
        </div>
      </div>
    `).join('');
    $all('#tasksList .item-card').forEach(card => {
      card.addEventListener('click', () => openTaskDetail(Number(card.dataset.id)));
    });
  } catch (e) {
    list.innerHTML = `<div class="empty-state">تعذر تحميل المهام</div>`;
  }
}

async function openCreateTaskModal() {
  if (state.agentsCache.length === 0) { try { await loadAgents(); } catch (e) {} }
  if (state.staffCache.length === 0) { try { await loadStaff(); } catch (e) {} }
  if (state.officesCache.length === 0) { try { await loadOffices(); } catch (e) {} }
  const agentOptions = state.agentsCache.map(a => `<option value="${a.id}">${escapeHtml(a.full_name)}</option>`).join('');
  const staffOptions = state.staffCache.map(s => `<option value="${s.id}">${escapeHtml(s.full_name)}</option>`).join('');
  const officeOptions = `<option value="">اختر المكتب...</option>${state.officesCache.filter(o => o.active).map(o => `<option value="${escapeHtml(o.name)}">${escapeHtml(o.name)}</option>`).join('')}`;

  openModal(`
    <h2>إضافة مهمة جديدة</h2>
    <form id="createTaskForm">
      <div class="form-grid">
        <div class="form-group full"><label>نوع المهمة</label>
          <select name="task_type" id="taskTypeSelect">
            <option value="عادية">مهمة عادية (تُسند إلى مخوّل)</option>
            <option value="عاجلة">مهمة عاجلة (تُسند إلى مخوّل)</option>
            <option value="متابعة_بريد">متابعة مخول (تُسند إلى موظف متابعة)</option>
          </select>
        </div>
        <div class="form-group full"><label>عنوان المهمة</label><input type="text" name="title" required></div>
        <div class="form-group"><label>اسم المكتب صاحب الطلب</label><select name="office_name" required>${officeOptions}</select></div>

        <div class="form-group" id="assignAgentGroup"><label>اسناد المهمة الى المخوّل</label>
          <select name="assigned_to_agent"><option value="">اختر المخوّل...</option>${agentOptions}</select>
        </div>
        <div class="form-group hidden" id="assignStaffGroup"><label>اسناد المهمة الى الموظف</label>
          <select name="assigned_to_staff"><option value="">اختر الموظف...</option>${staffOptions}</select>
        </div>

        <div class="form-group hidden" id="targetTypeGroup"><label>الجهة المتابَعة</label>
          <select name="target_type" id="targetTypeSelect">
            <option value="مخول">مخوّل محدد</option>
            <option value="مكتب">مكتب محدد</option>
          </select>
        </div>
        <div class="form-group hidden" id="targetAgentGroup"><label>اختر المخوّل المتابَع</label>
          <select name="target_agent_id">${agentOptions}</select>
        </div>
        <div class="form-group hidden" id="targetOfficeGroup"><label>اسم المكتب المتابَع</label>
          <select name="target_office">${officeOptions}</select>
        </div>

        <div class="form-group"><label>التاريخ (تاريخ الاستحقاق)</label><input type="date" name="due_date" required></div>
        <div class="form-group"><label>ارفاق ملف</label><input type="file" name="attachment"></div>
        <div class="form-group full"><label>التفاصيل</label><textarea name="details" rows="4"></textarea></div>
      </div>
      <div id="createTaskError" class="error-text"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost-dark" onclick="closeModal()">إلغاء</button>
        <button type="submit" class="btn btn-primary">حفظ المهمة</button>
      </div>
    </form>
  `);

  function syncTaskTypeUI() {
    const isMail = $('#taskTypeSelect').value === 'متابعة_بريد';
    $('#assignAgentGroup').classList.toggle('hidden', isMail);
    $('#assignStaffGroup').classList.toggle('hidden', !isMail);
    $('#targetTypeGroup').classList.toggle('hidden', !isMail);
    if (isMail) syncTargetTypeUI(); else { $('#targetAgentGroup').classList.add('hidden'); $('#targetOfficeGroup').classList.add('hidden'); }
  }
  function syncTargetTypeUI() {
    const isAgentTarget = $('#targetTypeSelect').value === 'مخول';
    $('#targetAgentGroup').classList.toggle('hidden', !isAgentTarget);
    $('#targetOfficeGroup').classList.toggle('hidden', isAgentTarget);
  }
  $('#taskTypeSelect').addEventListener('change', syncTaskTypeUI);
  $('#targetTypeSelect').addEventListener('change', syncTargetTypeUI);
  syncTaskTypeUI();

  $('#createTaskForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const taskType = fd.get('task_type');
    const isMail = taskType === 'متابعة_بريد';
    const assignedTo = isMail ? fd.get('assigned_to_staff') : fd.get('assigned_to_agent');
    if (!assignedTo) {
      $('#createTaskError').textContent = isMail ? 'يرجى اختيار الموظف' : 'يرجى اختيار المخوّل';
      return;
    }
    const submitFd = new FormData();
    submitFd.set('title', fd.get('title'));
    submitFd.set('office_name', fd.get('office_name'));
    submitFd.set('details', fd.get('details') || '');
    submitFd.set('due_date', fd.get('due_date'));
    submitFd.set('assigned_to', assignedTo);
    submitFd.set('task_type', taskType);
    if (isMail) {
      submitFd.set('target_type', fd.get('target_type'));
      if (fd.get('target_type') === 'مخول') submitFd.set('target_agent_id', fd.get('target_agent_id'));
      else submitFd.set('target_office', fd.get('target_office'));
    }
    const attachment = fd.get('attachment');
    if (attachment && attachment.size) submitFd.set('attachment', attachment);

    try {
      await api('/tasks', { method: 'POST', body: submitFd, isForm: true });
      toast('تمت إضافة المهمة بنجاح');
      closeModal();
      if (state.view === 'home') renderHome(); else renderTasks(state.view === 'overdue');
    } catch (err) {
      $('#createTaskError').textContent = err.message;
    }
  });
}

async function openTaskDetail(id) {
  openModal('<div style="text-align:center;padding:30px">جارِ التحميل...</div>');
  try {
    const { task, events } = await api('/tasks/' + id);
    const canUpdateStatus = isPersonAssignable(state.me.role) && task.assigned_to === state.me.id;
    const canEdit = state.me.role === 'admin';
    const isMail = task.task_type === 'متابعة_بريد';

    openModal(`
      <div class="modal-close-row"><button class="btn btn-ghost-dark btn-sm" onclick="closeModal()">إغلاق</button></div>
      <h2>${escapeHtml(task.title)} ${isMail ? '<span class="badge badge-role">📮 متابعة مخول</span>' : ''} ${isUrgentTask(task) ? '<span class="badge badge-urgent">⚡ عاجلة</span>' : ''}</h2>
      <div class="detail-row"><div class="k">المكتب صاحب الطلب</div><div class="v">${escapeHtml(task.office_name)}</div></div>
      <div class="detail-row"><div class="k">${isMail ? 'الموظف المسؤول' : 'المخوّل'}</div><div class="v">${escapeHtml(task.assignee_name)}</div></div>
      ${isMail ? `<div class="detail-row"><div class="k">الجهة المتابَعة</div><div class="v">${escapeHtml(taskTargetLabel(task))}</div></div>` : ''}
      <div class="detail-row"><div class="k">تاريخ الاستحقاق</div><div class="v">${fmtDate(task.due_date)} ${task.overdue ? '<span class="badge badge-overdue">متأخرة</span>' : ''}</div></div>
      <div class="detail-row"><div class="k">الحالة</div><div class="v">${statusBadge(task.status)}</div></div>
      ${task.status === 'منجز' ? `<div class="detail-row"><div class="k">تاريخ الإنجاز</div><div class="v">${fmtDate(task.completion_date)}</div></div>` : ''}
      ${task.status === 'مرفوض' ? `<div class="detail-row"><div class="k">سبب الرفض</div><div class="v">${escapeHtml(task.rejection_reason || '')}</div></div>` : ''}
      <div class="detail-row"><div class="k">التفاصيل</div><div class="v">${escapeHtml(task.details || '—')}</div></div>
      <div class="detail-row"><div class="k">المرفق الأصلي</div><div class="v">${task.attachment_path ? `<a class="attachment-link" target="_blank" href="${task.attachment_path}">📎 ${escapeHtml(task.attachment_name || 'عرض الملف')}</a>` : '—'}</div></div>
      ${task.completion_attachment_path ? `<div class="detail-row"><div class="k">مرفق الإنجاز</div><div class="v"><a class="attachment-link" target="_blank" href="${task.completion_attachment_path}">📎 ${escapeHtml(task.completion_attachment_name || 'عرض الملف')}</a></div></div>` : ''}

      ${canUpdateStatus ? renderStatusUpdateForm(task) : ''}
      ${canEdit ? `
        <div class="form-actions" style="margin-top:16px">
          <button class="btn btn-danger btn-sm" id="deleteTaskBtn">حذف المهمة</button>
          <button class="btn btn-ghost-dark btn-sm" id="editTaskBtn">تعديل / إعادة إسناد</button>
        </div>
      ` : ''}
    `);

    if (canUpdateStatus) wireStatusUpdateForm(task);
    if (canEdit) {
      $('#deleteTaskBtn').addEventListener('click', async () => {
        if (!confirm('هل أنت متأكد من حذف هذه المهمة؟')) return;
        await api('/tasks/' + task.id, { method: 'DELETE' });
        toast('تم حذف المهمة');
        closeModal();
        if (state.view === 'home') renderHome(); else setView(state.view);
      });
      $('#editTaskBtn').addEventListener('click', () => openEditTaskModal(task));
    }
  } catch (e) {
    openModal(`<div class="empty-state">تعذر تحميل تفاصيل المهمة</div>`);
  }
}

function renderStatusUpdateForm(task) {
  return `
    <form id="statusForm" style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
      <label style="font-weight:700;font-size:14px;display:block;margin-bottom:8px">تحديث حالة المهمة</label>
      <div class="status-actions">
        <button type="button" class="btn ${task.status === 'قيد الانجاز' ? 'btn-primary' : 'btn-secondary'}" data-status="قيد الانجاز">قيد الانجاز</button>
        <button type="button" class="btn ${task.status === 'منجز' ? 'btn-primary' : 'btn-secondary'}" data-status="منجز">منجز</button>
        <button type="button" class="btn ${task.status === 'مرفوض' ? 'btn-primary' : 'btn-secondary'}" data-status="مرفوض">مرفوض</button>
      </div>
      <div id="rejectionField" class="form-group hidden" style="margin-top:10px">
        <label>سبب الرفض</label>
        <textarea name="rejection_reason" rows="2"></textarea>
      </div>
      <div class="form-group" style="margin-top:10px">
        <label>إعادة رفع ملف (اختياري)</label>
        <input type="file" name="attachment">
      </div>
      <input type="hidden" name="status" value="">
      <div id="statusFormError" class="error-text"></div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">حفظ التحديث</button>
      </div>
    </form>
  `;
}

function wireStatusUpdateForm(task) {
  const form = $('#statusForm');
  let selectedStatus = task.status;
  $all('#statusForm .status-actions button').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedStatus = btn.dataset.status;
      $all('#statusForm .status-actions button').forEach(b => b.classList.remove('btn-primary'));
      $all('#statusForm .status-actions button').forEach(b => b.classList.add('btn-secondary'));
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn-primary');
      $('#rejectionField').classList.toggle('hidden', selectedStatus !== 'مرفوض');
    });
  });
  $('#rejectionField').classList.toggle('hidden', task.status !== 'مرفوض');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    fd.set('status', selectedStatus);
    if (selectedStatus === 'مرفوض' && !fd.get('rejection_reason')) {
      $('#statusFormError').textContent = 'يرجى ذكر سبب الرفض';
      return;
    }
    try {
      await api(`/tasks/${task.id}/status`, { method: 'PUT', body: fd, isForm: true });
      toast('تم تحديث حالة المهمة');
      closeModal();
      setView(state.view);
    } catch (err) {
      $('#statusFormError').textContent = err.message;
    }
  });
}

async function openEditTaskModal(task) {
  const isMail = task.task_type === 'متابعة_بريد';
  if (isMail) { if (state.staffCache.length === 0) { try { await loadStaff(); } catch (e) {} } }
  else { if (state.agentsCache.length === 0) { try { await loadAgents(); } catch (e) {} } }
  if (state.officesCache.length === 0) { try { await loadOffices(); } catch (e) {} }
  const pool = isMail ? state.staffCache : state.agentsCache;
  const assignOptions = pool.map(a => `<option value="${a.id}" ${a.id === task.assigned_to ? 'selected' : ''}>${escapeHtml(a.full_name)}</option>`).join('');
  const officeOptionsList = state.officesCache.filter(o => o.active || o.name === task.office_name);
  const officeOptions = officeOptionsList.map(o => `<option value="${escapeHtml(o.name)}" ${o.name === task.office_name ? 'selected' : ''}>${escapeHtml(o.name)}</option>`).join('')
    + (officeOptionsList.some(o => o.name === task.office_name) ? '' : `<option value="${escapeAttr(task.office_name)}" selected>${escapeHtml(task.office_name)} (غير موجود في القائمة)</option>`);
  openModal(`
    <h2>تعديل المهمة ${isMail ? '<span class="badge badge-role">📮 متابعة مخول</span>' : ''} ${isUrgentTask(task) ? '<span class="badge badge-urgent">⚡ عاجلة</span>' : ''}</h2>
    <form id="editTaskForm">
      <div class="form-grid">
        <div class="form-group full">
          <label>عنوان المهمة</label>
          <input type="text" name="title" required value="${escapeAttr(task.title)}">
        </div>
        <div class="form-group">
          <label>اسم المكتب صاحب الطلب</label>
          <select name="office_name" required>${officeOptions}</select>
        </div>
        <div class="form-group">
          <label>${isMail ? 'اسناد المهمة الى الموظف' : 'اسناد المهمة الى المخوّل'}</label>
          <select name="assigned_to">${assignOptions}</select>
        </div>
        <div class="form-group">
          <label>تاريخ الاستحقاق</label>
          <input type="date" name="due_date" required value="${task.due_date}">
        </div>
        <div class="form-group">
          <label>استبدال المرفق (اختياري)</label>
          <input type="file" name="attachment">
        </div>
        <div class="form-group full">
          <label>التفاصيل</label>
          <textarea name="details" rows="4">${escapeHtml(task.details || '')}</textarea>
        </div>
      </div>
      <div id="editTaskError" class="error-text"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost-dark" onclick="closeModal()">إلغاء</button>
        <button type="submit" class="btn btn-primary">حفظ</button>
      </div>
    </form>
  `);

  $('#editTaskForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api(`/tasks/${task.id}`, { method: 'PUT', body: fd, isForm: true });
      toast('تم حفظ التعديلات');
      closeModal();
      setView(state.view);
    } catch (err) {
      $('#editTaskError').textContent = err.message;
    }
  });
}

// ================= التقارير =================
async function renderReports() {
  const main = $('#mainContent');
  if (state.agentsCache.length === 0) { try { await loadAgents(); } catch (e) {} }
  if (state.officesCache.length === 0) { try { await loadOffices(); } catch (e) {} }
  const agentOptions = state.agentsCache.map(a => `<option value="${a.id}">${escapeHtml(a.full_name)}</option>`).join('');

  main.innerHTML = `
    <div class="section-header"><h2>التقارير</h2></div>
    <div class="report-tabs">
      <button class="btn btn-secondary report-tab-btn active" data-tab="general">تقرير عام</button>
      <button class="btn btn-secondary report-tab-btn" data-tab="agent">تقرير لكل مخوّل</button>
      <button class="btn btn-secondary report-tab-btn" data-tab="office">تقرير لكل مكتب</button>
    </div>
    <div id="reportControls"></div>
    <div id="reportContent">جارِ التحميل...</div>
  `;

  $all('.report-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $all('.report-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.reportSubTab = btn.dataset.tab;
      renderControls();
      loadReport();
    });
  });

  function renderControls() {
    const ctrl = $('#reportControls');
    if (state.reportSubTab === 'agent') {
      ctrl.innerHTML = `<div class="filters-bar"><select id="reportAgentSelect"><option value="">اختر المخوّل...</option>${agentOptions}</select></div>`;
      $('#reportAgentSelect').addEventListener('change', loadReport);
    } else if (state.reportSubTab === 'office') {
      const officeOptions = state.officesCache.map(o => `<option value="${escapeHtml(o.name)}">${escapeHtml(o.name)}</option>`).join('');
      ctrl.innerHTML = `<div class="filters-bar"><select id="reportOfficeSelect"><option value="">اختر المكتب...</option>${officeOptions}</select></div>`;
      $('#reportOfficeSelect').addEventListener('change', loadReport);
    } else {
      ctrl.innerHTML = '';
    }
  }
  renderControls();
  window.__renderReportControls = renderControls;
  await loadReport();
}

function selectAgentReport(agentId) {
  $all('.report-tab-btn').forEach(b => b.classList.remove('active'));
  const btn = $('.report-tab-btn[data-tab="agent"]');
  if (btn) btn.classList.add('active');
  state.reportSubTab = 'agent';
  if (window.__renderReportControls) window.__renderReportControls();
  const sel = $('#reportAgentSelect');
  if (sel) { sel.value = agentId; loadReport(); }
}

async function loadReport() {
  const content = $('#reportContent');
  content.innerHTML = 'جارِ التحميل...';
  try {
    let data, exportUrl;
    if (state.reportSubTab === 'agent') {
      const sel = $('#reportAgentSelect');
      const agentId = sel ? sel.value : '';
      if (!agentId) { content.innerHTML = `<div class="empty-state">اختر مخوّلاً لعرض تقريره</div>`; return; }
      data = await api('/reports/agent/' + agentId);
      exportUrl = `/api/reports/export?type=agent&agentId=${agentId}`;
    } else if (state.reportSubTab === 'office') {
      const sel = $('#reportOfficeSelect');
      const office = sel ? sel.value : '';
      if (!office) { content.innerHTML = `<div class="empty-state">اختر مكتباً لعرض تقريره</div>`; return; }
      data = await api('/reports/office?name=' + encodeURIComponent(office));
      exportUrl = `/api/reports/export?type=office&office=${encodeURIComponent(office)}`;
    } else {
      data = await api('/reports/general');
      exportUrl = `/api/reports/export?type=general`;
    }

    const s = data.summary;
    content.innerHTML = `
      <div class="summary-grid">
        <div class="summary-tile"><div class="num">${s.total}</div><div class="label">الإجمالي</div></div>
        <div class="summary-tile"><div class="num">${s.done}</div><div class="label">منجزة</div></div>
        <div class="summary-tile"><div class="num">${s.pending}</div><div class="label">قيد الانجاز</div></div>
        <div class="summary-tile"><div class="num">${s.rejected}</div><div class="label">مرفوضة</div></div>
        <div class="summary-tile"><div class="num">${s.overdue}</div><div class="label">متأخرة</div></div>
      </div>
      <div style="margin-bottom:12px"><a class="btn btn-secondary btn-sm" href="${exportUrl}" target="_blank">⬇️ تصدير Excel</a></div>
      <div class="table-wrap">
        <table class="report-table">
          <thead><tr>
            <th>العنوان</th><th>المكتب</th><th>المخوّل</th><th>الاستحقاق</th><th>الحالة</th><th>الإنجاز</th>
          </tr></thead>
          <tbody>
            ${data.tasks.map(t => `
              <tr>
                <td>${escapeHtml(t.title)}</td>
                <td>${escapeHtml(t.office_name)}</td>
                <td>${escapeHtml(t.assignee_name)}</td>
                <td>${fmtDate(t.due_date)}${t.overdue ? ' ⏰' : ''}</td>
                <td>${statusBadge(t.status)}</td>
                <td>${fmtDate(t.completion_date)}</td>
              </tr>
            `).join('') || `<tr><td colspan="6" style="text-align:center;color:var(--muted)">لا توجد بيانات</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    content.innerHTML = `<div class="empty-state">تعذر تحميل التقرير</div>`;
  }
}

// ================= إدارة الحسابات =================
async function renderAccounts() {
  const main = $('#mainContent');
  main.innerHTML = `
    <div class="section-header">
      <h2>إدارة الحسابات</h2>
      <button class="btn btn-primary btn-sm" id="addAccountBtn">＋ إضافة حساب</button>
    </div>
    <div id="accountsList" class="card-list">جارِ التحميل...</div>
  `;
  $('#addAccountBtn').addEventListener('click', () => openAccountForm());
  try {
    const { users } = await api('/users');
    const list = $('#accountsList');
    list.innerHTML = users.map(u => `
      <div class="item-card" data-id="${u.id}">
        ${avatarHtml(u.photo, u.full_name)}
        <div class="item-body">
          <div class="item-title">${escapeHtml(u.full_name)} ${!u.active ? '<span class="badge badge-rejected">معطّل</span>' : ''}</div>
          <div class="item-sub">${escapeHtml(u.username)}</div>
        </div>
        <span class="badge badge-role">${roleLabel(u.role)}</span>
      </div>
    `).join('');
    $all('#accountsList .item-card').forEach(card => {
      card.addEventListener('click', () => {
        const u = users.find(x => x.id === Number(card.dataset.id));
        openAccountForm(u);
      });
    });
  } catch (e) {
    $('#accountsList').innerHTML = `<div class="empty-state">تعذر تحميل الحسابات</div>`;
  }
}

function openAccountForm(user = null) {
  const isEdit = Boolean(user);
  openModal(`
    <h2>${isEdit ? 'تعديل حساب' : 'إضافة حساب جديد'}</h2>
    <form id="accountForm">
      <div class="form-grid">
        <div class="form-group full">
          <label>صورة (اختياري)</label>
          <input type="file" name="photo" accept="image/*">
        </div>
        <div class="form-group">
          <label>الاسم الكامل</label>
          <input type="text" name="full_name" required value="${isEdit ? escapeAttr(user.full_name) : ''}">
        </div>
        <div class="form-group">
          <label>الدور</label>
          <select name="role" ${isEdit ? '' : 'required'}>
            <option value="admin" ${isEdit && user.role === 'admin' ? 'selected' : ''}>مسؤول رئيسي</option>
            <option value="agent" ${isEdit && user.role === 'agent' ? 'selected' : ''}>مخوّل</option>
            <option value="staff" ${isEdit && user.role === 'staff' ? 'selected' : ''}>موظف متابعة</option>
            <option value="viewer" ${isEdit && user.role === 'viewer' ? 'selected' : ''}>اطلاع فقط</option>
          </select>
        </div>
        ${!isEdit ? `
        <div class="form-group">
          <label>اسم المستخدم</label>
          <input type="text" name="username" required>
        </div>
        <div class="form-group">
          <label>كلمة المرور</label>
          <input type="password" name="password" required>
        </div>` : `
        <div class="form-group">
          <label>كلمة مرور جديدة (اختياري)</label>
          <input type="password" name="password" placeholder="اتركه فارغاً لعدم التغيير">
        </div>
        <div class="form-group">
          <label>الحالة</label>
          <select name="active">
            <option value="true" ${user.active ? 'selected' : ''}>فعّال</option>
            <option value="false" ${!user.active ? 'selected' : ''}>معطّل</option>
          </select>
        </div>`}
        <div class="form-group">
          <label>رقم الهاتف</label>
          <input type="text" name="phone" value="${isEdit ? escapeAttr(user.phone || '') : ''}">
        </div>
      </div>
      <div id="accountFormError" class="error-text"></div>
      <div class="form-actions">
        ${isEdit ? `<button type="button" class="btn btn-danger" id="deleteAccountBtn">حذف الحساب</button>` : ''}
        <button type="button" class="btn btn-ghost-dark" onclick="closeModal()">إلغاء</button>
        <button type="submit" class="btn btn-primary">حفظ</button>
      </div>
    </form>
  `);

  $('#accountForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      if (isEdit) {
        await api(`/users/${user.id}`, { method: 'PUT', body: fd, isForm: true });
      } else {
        await api('/users', { method: 'POST', body: fd, isForm: true });
      }
      toast('تم الحفظ بنجاح');
      closeModal();
      renderAccounts();
    } catch (err) {
      $('#accountFormError').textContent = err.message;
    }
  });

  const delBtn = $('#deleteAccountBtn');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      if (!confirm('هل أنت متأكد من حذف هذا الحساب؟')) return;
      try {
        await api(`/users/${user.id}`, { method: 'DELETE' });
        toast('تم الحذف / التعطيل');
        closeModal();
        renderAccounts();
      } catch (err) {
        $('#accountFormError').textContent = err.message;
      }
    });
  }
}

// ---------------- تعقيم النصوص ----------------
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(str) { return escapeHtml(str); }

// ---------------- تسجيل Service Worker ----------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  });
}

// ---------------- بدء التشغيل ----------------
checkSession();
