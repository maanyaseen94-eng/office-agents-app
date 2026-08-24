require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const ExcelJS = require('exceljs');

const db = require('./db');
const { requireAuth, requireRole, issueToken, clearToken } = require('./auth');
const telegram = require('./telegram');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- إعداد رفع الملفات (تُخزَّن كبيانات ثنائية في قاعدة البيانات) ----------
// لا يوجد قرص دائم يمكن الكتابة عليه على الاستضافة اللا-خادمية (Vercel)، لذا
// تُستقبل الملفات في الذاكرة مؤقتاً ثم تُحفظ داخل جدول files، وتُخدَّم لاحقاً
// عبر المسار /api/files/:id.
const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

async function saveUploadedFile(file) {
  if (!file) return null;
  const id = crypto.randomUUID();
  await db.run(
    'INSERT INTO files (id, filename, mimetype, size, data) VALUES (?,?,?,?,?)',
    id, file.originalname, file.mimetype, file.size, file.buffer
  );
  return { id, path: `/api/files/${id}`, name: file.originalname };
}

// ---------- إعدادات عامة ----------
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(express.static(path.join(__dirname, '..', 'public')));

// يلتقط أي خطأ غير متوقع داخل معالج async ويحوّله لاستجابة 500 بدل تعطّل الطلب بصمت
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const today = () => new Date().toISOString().slice(0, 10);

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    full_name: u.full_name,
    role: u.role,
    photo: u.photo,
    phone: u.phone,
    active: u.active,
    created_at: u.created_at
  };
}

function taskWithMeta(t) {
  const overdue = t.status === 'قيد الانجاز' && t.due_date < today();
  return { ...t, overdue };
}

// الأدوار التي تُسند إليها المهام مباشرة (مخوّل عادي/عاجل، أو موظف متابعة)
function isPersonAssignableRole(role) {
  return role === 'agent' || role === 'staff';
}

function taskTypeLabel(t) {
  if (t.task_type === 'متابعة_بريد') return 'متابعة مخول';
  if (t.task_type === 'عاجلة') return 'مهمة عاجلة';
  return 'مهمة عادية';
}

async function logEvent(taskId, event, actorId) {
  await db.run('INSERT INTO task_events (task_id, event, actor_id) VALUES (?,?,?)', taskId, event, actorId || null);
}

// =========================================================
// تخديم الملفات المرفوعة (صور المخولين، مرفقات المهام)
// =========================================================
app.get('/api/files/:id', requireAuth, ah(async (req, res) => {
  const file = await db.get('SELECT * FROM files WHERE id = ?', req.params.id);
  if (!file) return res.status(404).json({ error: 'الملف غير موجود' });
  res.setHeader('Content-Type', file.mimetype || 'application/octet-stream');
  const safeName = encodeURIComponent(file.filename || 'file');
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  res.send(Buffer.from(file.data));
}));

// =========================================================
// المصادقة
// =========================================================
app.post('/api/login', ah(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'الرجاء إدخال اسم المستخدم وكلمة المرور' });
  const user = await db.get('SELECT * FROM users WHERE username = ?', username.trim());
  if (!user || !user.active) return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  issueToken(res, user);
  res.json({ user: publicUser(user) });
}));

app.post('/api/logout', (req, res) => {
  clearToken(res);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, ah(async (req, res) => {
  const user = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!user) return res.status(401).json({ error: 'الجلسة غير صالحة' });
  res.json({ user: publicUser(user) });
}));

app.post('/api/change-password', requireAuth, ah(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون 4 أحرف على الأقل' });
  }
  const user = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!bcrypt.compareSync(currentPassword || '', user.password_hash)) {
    return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, user.id);
  res.json({ ok: true });
}));

// =========================================================
// إدارة الحسابات (رئيس/مخول/اطلاع) — للمسؤول الرئيسي فقط
// =========================================================
app.get('/api/users', requireAuth, requireRole('admin'), ah(async (req, res) => {
  const users = await db.all('SELECT * FROM users ORDER BY created_at DESC');
  res.json({ users: users.map(publicUser) });
}));

// قائمة المخولين (يمكن للجميع المصادَق عليهم رؤيتها لأغراض الإسناد والعرض)
app.get('/api/agents', requireAuth, ah(async (req, res) => {
  const agents = await db.all("SELECT * FROM users WHERE role = 'agent' AND active = 1 ORDER BY full_name");
  res.json({ agents: agents.map(publicUser) });
}));

// قائمة موظفي المتابعة (لإسناد مهام متابعة بريد المخولين/المكاتب)
app.get('/api/staff', requireAuth, ah(async (req, res) => {
  const staff = await db.all("SELECT * FROM users WHERE role = 'staff' AND active = 1 ORDER BY full_name");
  res.json({ staff: staff.map(publicUser) });
}));

app.post('/api/users', requireAuth, requireRole('admin'), memoryUpload.single('photo'), ah(async (req, res) => {
  const { username, password, full_name, role, phone } = req.body || {};
  if (!username || !password || !full_name || !role) {
    return res.status(400).json({ error: 'جميع الحقول الأساسية مطلوبة' });
  }
  if (!['admin', 'agent', 'staff', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'دور غير صالح' });
  }
  const exists = await db.get('SELECT id FROM users WHERE username = ?', username.trim());
  if (exists) return res.status(400).json({ error: 'اسم المستخدم موجود مسبقاً' });

  const hash = bcrypt.hashSync(password, 10);
  const savedPhoto = await saveUploadedFile(req.file);
  const info = await db.run(
    `INSERT INTO users (username, password_hash, full_name, role, photo, phone) VALUES (?,?,?,?,?,?)`,
    username.trim(), hash, full_name.trim(), role, savedPhoto ? savedPhoto.path : null, phone || null
  );
  const user = await db.get('SELECT * FROM users WHERE id = ?', info.lastInsertRowid);
  res.json({ user: publicUser(user) });
}));

app.put('/api/users/:id', requireAuth, requireRole('admin'), memoryUpload.single('photo'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const user = await db.get('SELECT * FROM users WHERE id = ?', id);
  if (!user) return res.status(404).json({ error: 'الحساب غير موجود' });

  const { full_name, phone, active, password, role } = req.body || {};
  const fields = [];
  const values = [];

  if (full_name) { fields.push('full_name = ?'); values.push(full_name.trim()); }
  if (phone !== undefined) { fields.push('phone = ?'); values.push(phone || null); }
  if (active !== undefined) { fields.push('active = ?'); values.push(active === 'true' || active === true || active === 1 ? 1 : 0); }
  if (role && ['admin', 'agent', 'staff', 'viewer'].includes(role)) { fields.push('role = ?'); values.push(role); }
  if (password) { fields.push('password_hash = ?'); values.push(bcrypt.hashSync(password, 10)); }
  if (req.file) {
    const savedPhoto = await saveUploadedFile(req.file);
    fields.push('photo = ?'); values.push(savedPhoto.path);
  }

  if (fields.length) {
    values.push(id);
    await db.run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, ...values);
  }
  const updated = await db.get('SELECT * FROM users WHERE id = ?', id);
  res.json({ user: publicUser(updated) });
}));

app.delete('/api/users/:id', requireAuth, requireRole('admin'), ah(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'لا يمكنك حذف حسابك الخاص' });
  const hasTasksRow = await db.get('SELECT COUNT(*) c FROM tasks WHERE assigned_to = ?', id);
  if (Number(hasTasksRow.c) > 0) {
    // تعطيل بدلاً من الحذف للحفاظ على سجل المهام
    await db.run('UPDATE users SET active = 0 WHERE id = ?', id);
    return res.json({ ok: true, deactivated: true });
  }
  await db.run('DELETE FROM users WHERE id = ?', id);
  res.json({ ok: true, deleted: true });
}));

// =========================================================
// المكاتب
// =========================================================
app.get('/api/offices', requireAuth, ah(async (req, res) => {
  const offices = await db.all('SELECT * FROM offices ORDER BY name');
  res.json({ offices });
}));

app.post('/api/offices', requireAuth, requireRole('admin'), ah(async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'اسم المكتب مطلوب' });
  const exists = await db.get('SELECT id FROM offices WHERE name = ?', name.trim());
  if (exists) return res.status(400).json({ error: 'هذا المكتب مضاف مسبقاً' });
  const info = await db.run('INSERT INTO offices (name) VALUES (?)', name.trim());
  const office = await db.get('SELECT * FROM offices WHERE id = ?', info.lastInsertRowid);
  res.json({ office });
}));

app.put('/api/offices/:id', requireAuth, requireRole('admin'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const office = await db.get('SELECT * FROM offices WHERE id = ?', id);
  if (!office) return res.status(404).json({ error: 'المكتب غير موجود' });
  const { name, active } = req.body || {};
  const fields = [];
  const values = [];
  if (name && name.trim()) { fields.push('name = ?'); values.push(name.trim()); }
  if (active !== undefined) { fields.push('active = ?'); values.push(active === 'true' || active === true || active === 1 ? 1 : 0); }
  if (fields.length) {
    values.push(id);
    await db.run(`UPDATE offices SET ${fields.join(', ')} WHERE id = ?`, ...values);
  }
  const updated = await db.get('SELECT * FROM offices WHERE id = ?', id);
  res.json({ office: updated });
}));

app.delete('/api/offices/:id', requireAuth, requireRole('admin'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const office = await db.get('SELECT * FROM offices WHERE id = ?', id);
  if (!office) return res.status(404).json({ error: 'المكتب غير موجود' });
  const inUseRow = await db.get('SELECT COUNT(*) c FROM tasks WHERE office_name = ?', office.name);
  if (Number(inUseRow.c) > 0) return res.status(400).json({ error: 'لا يمكن حذف مكتب مرتبط بمهام موجودة — يمكنك تعطيله بدلاً من ذلك' });
  await db.run('DELETE FROM offices WHERE id = ?', id);
  res.json({ ok: true });
}));

// =========================================================
// المهام / الطلبات
// =========================================================
app.get('/api/tasks', requireAuth, ah(async (req, res) => {
  const { status, assigned_to, office, overdue } = req.query;
  let sql = `SELECT t.*, u.full_name AS assignee_name, u.photo AS assignee_photo, ta.full_name AS target_agent_name
             FROM tasks t JOIN users u ON u.id = t.assigned_to
             LEFT JOIN users ta ON ta.id = t.target_agent_id WHERE 1=1`;
  const params = [];

  if (isPersonAssignableRole(req.user.role)) {
    sql += ' AND t.assigned_to = ?';
    params.push(req.user.id);
  }
  if (status) { sql += ' AND t.status = ?'; params.push(status); }
  if (assigned_to) { sql += ' AND t.assigned_to = ?'; params.push(Number(assigned_to)); }
  if (office) { sql += ' AND t.office_name LIKE ?'; params.push(`%${office}%`); }
  if (req.query.task_type) { sql += ' AND t.task_type = ?'; params.push(req.query.task_type); }

  sql += ' ORDER BY t.created_at DESC';
  let rows = (await db.all(sql, ...params)).map(taskWithMeta);

  if (overdue === 'true') rows = rows.filter(r => r.overdue);

  res.json({ tasks: rows });
}));

app.get('/api/tasks/:id', requireAuth, ah(async (req, res) => {
  const id = Number(req.params.id);
  const t = await db.get(
    `SELECT t.*, u.full_name AS assignee_name, u.photo AS assignee_photo, ta.full_name AS target_agent_name
     FROM tasks t JOIN users u ON u.id = t.assigned_to
     LEFT JOIN users ta ON ta.id = t.target_agent_id WHERE t.id = ?`,
    id
  );
  if (!t) return res.status(404).json({ error: 'المهمة غير موجودة' });
  if (isPersonAssignableRole(req.user.role) && t.assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'لا تملك صلاحية عرض هذه المهمة' });
  }
  const events = await db.all('SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC', id);
  res.json({ task: taskWithMeta(t), events });
}));

// إنشاء مهمة جديدة (زر "مهام") — للمسؤول الرئيسي
app.post('/api/tasks', requireAuth, requireRole('admin'), memoryUpload.single('attachment'), ah(async (req, res) => {
  const { title, office_name, details, assigned_to, due_date, task_type, target_type, target_agent_id, target_office } = req.body || {};
  if (!title || !office_name || !assigned_to || !due_date) {
    return res.status(400).json({ error: 'عنوان المهمة والمكتب والمخول/الموظف والتاريخ حقول مطلوبة' });
  }
  const taskType = ['عادية', 'عاجلة', 'متابعة_بريد'].includes(task_type) ? task_type : 'عادية';
  const isMail = taskType === 'متابعة_بريد';
  const assigneeRole = isMail ? 'staff' : 'agent';
  const assignee = await db.get('SELECT * FROM users WHERE id = ? AND role = ? AND active = 1', Number(assigned_to), assigneeRole);
  if (!assignee) {
    return res.status(400).json({ error: isMail ? 'الموظف المحدد غير موجود' : 'المخول المحدد غير موجود' });
  }

  let finalTargetType = null, finalTargetAgentId = null, finalTargetOffice = null;
  if (isMail) {
    if (!['مخول', 'مكتب'].includes(target_type)) {
      return res.status(400).json({ error: 'يرجى تحديد الجهة المتابَعة (مخوّل أو مكتب)' });
    }
    finalTargetType = target_type;
    if (target_type === 'مخول') {
      const targetAgent = await db.get("SELECT * FROM users WHERE id = ? AND role = 'agent'", Number(target_agent_id));
      if (!targetAgent) return res.status(400).json({ error: 'يرجى اختيار المخوّل المتابَع' });
      finalTargetAgentId = targetAgent.id;
    } else {
      if (!target_office || !target_office.trim()) return res.status(400).json({ error: 'يرجى اختيار المكتب المتابَع' });
      finalTargetOffice = target_office.trim();
    }
  }

  const savedAttachment = await saveUploadedFile(req.file);

  const info = await db.run(`
    INSERT INTO tasks (title, office_name, details, assigned_to, due_date, attachment_path, attachment_name, created_by, task_type, target_type, target_agent_id, target_office)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `,
    title.trim(), office_name.trim(), details || null, assignee.id, due_date,
    savedAttachment ? savedAttachment.path : null, savedAttachment ? savedAttachment.name : null,
    req.user.id, taskType, finalTargetType, finalTargetAgentId, finalTargetOffice
  );

  const task = await db.get('SELECT * FROM tasks WHERE id = ?', info.lastInsertRowid);
  await logEvent(task.id, 'تم إنشاء المهمة', req.user.id);

  telegram.archiveNewTask(task, assignee.full_name, task.office_name).catch(() => {});

  res.json({ task: taskWithMeta(task) });
}));

// تعديل بيانات مهمة (المسؤول الرئيسي فقط) — إعادة إسناد / تعديل تفاصيل
app.put('/api/tasks/:id', requireAuth, requireRole('admin'), memoryUpload.single('attachment'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await db.get('SELECT * FROM tasks WHERE id = ?', id);
  if (!existing) return res.status(404).json({ error: 'المهمة غير موجودة' });

  const { title, office_name, details, assigned_to, due_date } = req.body || {};
  const fields = [];
  const values = [];

  if (title) { fields.push('title = ?'); values.push(title.trim()); }
  if (office_name) { fields.push('office_name = ?'); values.push(office_name.trim()); }
  if (details !== undefined) { fields.push('details = ?'); values.push(details || null); }
  if (due_date) { fields.push('due_date = ?'); values.push(due_date); }
  if (assigned_to) {
    const assigneeRole = existing.task_type === 'متابعة_بريد' ? 'staff' : 'agent';
    const assignee = await db.get('SELECT * FROM users WHERE id = ? AND role = ?', Number(assigned_to), assigneeRole);
    if (!assignee) return res.status(400).json({ error: assigneeRole === 'staff' ? 'الموظف المحدد غير موجود' : 'المخول المحدد غير موجود' });
    fields.push('assigned_to = ?'); values.push(assignee.id);
  }
  if (req.file) {
    const savedAttachment = await saveUploadedFile(req.file);
    fields.push('attachment_path = ?'); values.push(savedAttachment.path);
    fields.push('attachment_name = ?'); values.push(savedAttachment.name);
  }
  fields.push("updated_at = datetime('now')");

  if (fields.length) {
    values.push(id);
    await db.run(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, ...values);
  }
  await logEvent(id, 'تم تعديل بيانات المهمة', req.user.id);
  const task = await db.get('SELECT * FROM tasks WHERE id = ?', id);
  res.json({ task: taskWithMeta(task) });
}));

// تحديث حالة المهمة (المخول صاحب المهمة، أو المسؤول)
app.put('/api/tasks/:id/status', requireAuth, requireRole('admin', 'agent', 'staff'), memoryUpload.single('attachment'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const task = await db.get('SELECT * FROM tasks WHERE id = ?', id);
  if (!task) return res.status(404).json({ error: 'المهمة غير موجودة' });
  if (isPersonAssignableRole(req.user.role) && task.assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'لا تملك صلاحية تعديل هذه المهمة' });
  }

  const { status, rejection_reason } = req.body || {};
  if (!['قيد الانجاز', 'منجز', 'مرفوض'].includes(status)) {
    return res.status(400).json({ error: 'حالة غير صالحة' });
  }
  if (status === 'مرفوض' && !rejection_reason) {
    return res.status(400).json({ error: 'يرجى ذكر سبب الرفض' });
  }

  const fields = ['status = ?'];
  const values = [status];

  if (status === 'منجز') {
    fields.push('completion_date = ?'); values.push(today());
    fields.push('rejection_reason = NULL');
  } else if (status === 'مرفوض') {
    fields.push('rejection_reason = ?'); values.push(rejection_reason);
    fields.push('completion_date = NULL');
  } else {
    fields.push('rejection_reason = NULL');
    fields.push('completion_date = NULL');
  }

  if (req.file) {
    const savedAttachment = await saveUploadedFile(req.file);
    fields.push('completion_attachment_path = ?'); values.push(savedAttachment.path);
    fields.push('completion_attachment_name = ?'); values.push(savedAttachment.name);
  }

  fields.push("updated_at = datetime('now')");
  values.push(id);
  await db.run(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, ...values);

  await logEvent(id, `تم تغيير الحالة إلى: ${status}`, req.user.id);

  const updated = await db.get('SELECT * FROM tasks WHERE id = ?', id);
  const agent = await db.get('SELECT * FROM users WHERE id = ?', updated.assigned_to);
  telegram.archiveTaskUpdate(updated, agent.full_name, updated.office_name).catch(() => {});

  res.json({ task: taskWithMeta(updated) });
}));

app.delete('/api/tasks/:id', requireAuth, requireRole('admin'), ah(async (req, res) => {
  const id = Number(req.params.id);
  await db.run('DELETE FROM task_events WHERE task_id = ?', id);
  await db.run('DELETE FROM tasks WHERE id = ?', id);
  res.json({ ok: true });
}));

// =========================================================
// لوحة الإحصائيات
// =========================================================
app.get('/api/stats', requireAuth, ah(async (req, res) => {
  const base = isPersonAssignableRole(req.user.role) ? 'WHERE assigned_to = ' + req.user.id : '';
  const all = await db.all(`SELECT * FROM tasks ${base}`);
  const agentsCountRow = await db.get("SELECT COUNT(*) c FROM users WHERE role = 'agent' AND active = 1");
  const overdueCount = all.filter(t => t.status === 'قيد الانجاز' && t.due_date < today()).length;
  const pendingCount = all.filter(t => t.status === 'قيد الانجاز').length;
  const doneCount = all.filter(t => t.status === 'منجز').length;
  const rejectedCount = all.filter(t => t.status === 'مرفوض').length;
  res.json({
    agentsCount: Number(agentsCountRow.c),
    tasksCount: all.length,
    overdueCount,
    pendingCount,
    doneCount,
    rejectedCount
  });
}));

// =========================================================
// التقارير
// =========================================================
async function buildReportRows({ agentId, officeName }) {
  let sql = `SELECT t.*, u.full_name AS assignee_name FROM tasks t JOIN users u ON u.id = t.assigned_to WHERE 1=1`;
  const params = [];
  if (agentId) { sql += ' AND t.assigned_to = ?'; params.push(agentId); }
  if (officeName) { sql += ' AND t.office_name LIKE ?'; params.push(`%${officeName}%`); }
  sql += ' ORDER BY t.created_at DESC';
  return (await db.all(sql, ...params)).map(taskWithMeta);
}

app.get('/api/reports/agent/:id', requireAuth, requireRole('admin', 'viewer'), ah(async (req, res) => {
  const agentId = Number(req.params.id);
  const agent = await db.get('SELECT * FROM users WHERE id = ?', agentId);
  if (!agent) return res.status(404).json({ error: 'المخول غير موجود' });
  const rows = await buildReportRows({ agentId });
  res.json({ agent: publicUser(agent), tasks: rows, summary: summarize(rows) });
}));

app.get('/api/reports/office', requireAuth, requireRole('admin', 'viewer'), ah(async (req, res) => {
  const officeName = req.query.name || '';
  const rows = await buildReportRows({ officeName });
  res.json({ office: officeName, tasks: rows, summary: summarize(rows) });
}));

app.get('/api/reports/general', requireAuth, requireRole('admin', 'viewer'), ah(async (req, res) => {
  const rows = await buildReportRows({});
  const byAgent = {};
  for (const r of rows) {
    byAgent[r.assignee_name] = byAgent[r.assignee_name] || [];
    byAgent[r.assignee_name].push(r);
  }
  const perAgentSummary = Object.entries(byAgent).map(([name, list]) => ({ name, ...summarize(list) }));
  res.json({ tasks: rows, summary: summarize(rows), perAgentSummary });
}));

function summarize(rows) {
  return {
    total: rows.length,
    done: rows.filter(r => r.status === 'منجز').length,
    pending: rows.filter(r => r.status === 'قيد الانجاز').length,
    rejected: rows.filter(r => r.status === 'مرفوض').length,
    overdue: rows.filter(r => r.overdue).length
  };
}

// تصدير Excel
app.get('/api/reports/export', requireAuth, requireRole('admin', 'viewer'), ah(async (req, res) => {
  const { type, agentId, office } = req.query;
  let rows = [];
  let sheetName = 'تقرير عام';

  if (type === 'agent' && agentId) {
    rows = await buildReportRows({ agentId: Number(agentId) });
    const agent = await db.get('SELECT * FROM users WHERE id = ?', Number(agentId));
    sheetName = `تقرير - ${agent ? agent.full_name : agentId}`;
  } else if (type === 'office' && office) {
    rows = await buildReportRows({ officeName: office });
    sheetName = `تقرير - ${office}`;
  } else {
    rows = await buildReportRows({});
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'نظام إدارة مخولين مكتب النائب';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName.slice(0, 30), { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });

  sheet.columns = [
    { header: 'ت', key: 'seq', width: 6 },
    { header: 'اسم المخول', key: 'agent', width: 22 },
    { header: 'اسم المكتب', key: 'office', width: 20 },
    { header: 'نوع الطلب', key: 'type', width: 16 },
    { header: 'موضوع الطلب', key: 'subject', width: 34 },
    { header: 'تأريخ اسناد الطلب للمخول', key: 'assigned_date', width: 22 },
    { header: 'تأريخ استلام الطلب من المخول', key: 'received_date', width: 24 },
    { header: 'حالة الطلب', key: 'status', width: 16 }
  ];

  rows.forEach((r, i) => {
    sheet.addRow({
      seq: i + 1,
      agent: r.assignee_name,
      office: r.office_name,
      type: taskTypeLabel(r),
      subject: r.title,
      assigned_date: r.due_date ? new Date(r.due_date) : null,
      received_date: r.completion_date ? new Date(r.completion_date) : null,
      status: r.status
    });
  });

  const lastRow = rows.length + 1;

  const headerRow = sheet.getRow(1);
  headerRow.height = 26;
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF123A63' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  for (let r = 2; r <= lastRow; r++) {
    sheet.getRow(r).eachCell(cell => { cell.alignment = { horizontal: 'center', vertical: 'middle' }; });
    sheet.getCell(`E${r}`).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    sheet.getCell(`F${r}`).numFmt = 'yyyy-mm-dd';
    sheet.getCell(`G${r}`).numFmt = 'yyyy-mm-dd';
  }

  // ورقة مخفية تحوي قوائم القيم المسموحة لتُستخدم كمصدر للقوائم المنسدلة
  const agentNames = [...new Set((await db.all("SELECT full_name FROM users WHERE role IN ('agent','staff') ORDER BY full_name")).map(u => u.full_name))];
  const officeNames = [...new Set((await db.all('SELECT name FROM offices ORDER BY name')).map(o => o.name))];
  const typeNames = ['مهمة عادية', 'مهمة عاجلة', 'متابعة مخول'];
  const statusNames = ['قيد الانجاز', 'منجز', 'مرفوض'];
  const listsSheet = workbook.addWorksheet('قوائم');
  listsSheet.state = 'hidden';
  agentNames.forEach((n, i) => { listsSheet.getCell(i + 1, 1).value = n; });
  officeNames.forEach((n, i) => { listsSheet.getCell(i + 1, 2).value = n; });
  typeNames.forEach((n, i) => { listsSheet.getCell(i + 1, 3).value = n; });
  statusNames.forEach((n, i) => { listsSheet.getCell(i + 1, 4).value = n; });

  for (let r = 2; r <= lastRow; r++) {
    if (agentNames.length) sheet.getCell(`B${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`قوائم!$A$1:$A$${agentNames.length}`] };
    if (officeNames.length) sheet.getCell(`C${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`قوائم!$B$1:$B$${officeNames.length}`] };
    sheet.getCell(`D${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`قوائم!$C$1:$C$${typeNames.length}`] };
    sheet.getCell(`H${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`قوائم!$D$1:$D$${statusNames.length}`] };
  }

  sheet.autoFilter = { from: 'A1', to: `H${lastRow}` };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}));

// =========================================================
// حالة بوت تلغرام
// =========================================================
app.get('/api/telegram/status', requireAuth, requireRole('admin'), (req, res) => {
  res.json({ enabled: telegram.isEnabled() });
});

// معالج أخطاء عام (يلتقط أي خطأ مرَّرته المعالجات async عبر ah())
app.use((err, req, res, next) => {
  console.error('خطأ غير متوقع:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'حدث خطأ غير متوقع في الخادم' });
});

// =========================================================
// تشغيل الخادم — محلياً فقط (على Vercel يُستدعى التطبيق كدالة بلا استماع مباشر)
// =========================================================
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`الخادم يعمل على المنفذ ${PORT}`);
    console.log(`افتح المتصفح على: http://localhost:${PORT}`);
  });
}

module.exports = app;
