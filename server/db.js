// db.js — تهيئة قاعدة البيانات (libSQL/Turso) وإنشاء الجداول والحساب الرئيسي الافتراضي
//
// يعمل هذا الملف بطريقتين حسب متغيرات البيئة:
// 1) محلياً (بدون أي متغيرات): يُنشئ ملف قاعدة بيانات محلي عادي (data/app.db) — يعمل تماماً
//    مثل SQLite السابق، مفيد للتجربة على جهازك.
// 2) على الاستضافة الحقيقية (Vercel): يجب ضبط TURSO_DATABASE_URL و TURSO_AUTH_TOKEN
//    (من حساب Turso المجاني بدون بطاقة) — عندها تُخزَّن البيانات في قاعدة بيانات سحابية
//    دائمة بدل القرص المحلي (الذي يُمسَح عند كل استدعاء على المنصات اللا-خادمية).
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { createClient } = require('@libsql/client');

const isServerless = Boolean(process.env.VERCEL);

let url = process.env.TURSO_DATABASE_URL;
let authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  if (isServerless) {
    // لا يوجد رابط Turso مضبوط على استضافة لا-خادمية: نستخدم قاعدة بيانات مؤقتة
    // كي لا يتعطل التطبيق كلياً، لكن البيانات ستُفقد بين الطلبات — يجب ضبط
    // TURSO_DATABASE_URL و TURSO_AUTH_TOKEN في إعدادات المشروع على Vercel.
    console.error('تحذير: لم يتم ضبط TURSO_DATABASE_URL — البيانات لن تُحفظ بشكل دائم!');
    url = 'file:/tmp/app.db';
  } else {
    const DATA_DIR = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    url = `file:${path.join(DATA_DIR, 'app.db')}`;
  }
}

const client = createClient(authToken ? { url, authToken } : { url });

// ---------- تهيئة الجداول (تُنفَّذ مرة واحدة عند أول استيراد للوحدة) ----------
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','agent','staff','viewer')),
    photo TEXT,
    phone TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS offices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    office_name TEXT NOT NULL,
    details TEXT,
    assigned_to INTEGER NOT NULL,
    due_date TEXT NOT NULL,
    attachment_path TEXT,
    attachment_name TEXT,
    status TEXT NOT NULL DEFAULT 'قيد الانجاز' CHECK(status IN ('قيد الانجاز','منجز','مرفوض')),
    rejection_reason TEXT,
    completion_date TEXT,
    completion_attachment_path TEXT,
    completion_attachment_name TEXT,
    task_type TEXT NOT NULL DEFAULT 'عادية' CHECK(task_type IN ('عادية','عاجلة','متابعة_بريد')),
    target_type TEXT CHECK(target_type IN ('مخول','مكتب') OR target_type IS NULL),
    target_agent_id INTEGER,
    target_office TEXT,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(assigned_to) REFERENCES users(id),
    FOREIGN KEY(created_by) REFERENCES users(id),
    FOREIGN KEY(target_agent_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    event TEXT NOT NULL,
    actor_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(task_id) REFERENCES tasks(id)
  )`,
  // ملفات مرفوعة (صور المخولين، مرفقات المهام) — تُخزَّن كبيانات ثنائية داخل
  // قاعدة البيانات نفسها بدل القرص، لأن الاستضافة اللا-خادمية (Vercel) لا تملك
  // قرصاً دائماً يمكن الكتابة عليه بين الطلبات.
  `CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    filename TEXT,
    mimetype TEXT,
    size INTEGER,
    data BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`
];

async function ensureColumn(table, column, ddl) {
  const info = await client.execute(`PRAGMA table_info(${table})`);
  const has = info.rows.some(r => r.name === column);
  if (!has) await client.execute(ddl);
}

let readyPromise = null;
function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      for (const stmt of SCHEMA_STATEMENTS) await client.execute(stmt);

      // ترقية قواعد بيانات قديمة أُنشئت قبل إضافة أعمدة نوع/جهة المهمة
      await ensureColumn('tasks', 'task_type', `ALTER TABLE tasks ADD COLUMN task_type TEXT NOT NULL DEFAULT 'عادية'`);
      await ensureColumn('tasks', 'target_type', `ALTER TABLE tasks ADD COLUMN target_type TEXT`);
      await ensureColumn('tasks', 'target_agent_id', `ALTER TABLE tasks ADD COLUMN target_agent_id INTEGER`);
      await ensureColumn('tasks', 'target_office', `ALTER TABLE tasks ADD COLUMN target_office TEXT`);

      const userCountRs = await client.execute('SELECT COUNT(*) AS c FROM users');
      const userCount = Number(userCountRs.rows[0].c);
      if (userCount === 0) {
        const defaultPassword = 'admin123';
        const hash = bcrypt.hashSync(defaultPassword, 10);
        await client.execute({
          sql: `INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)`,
          args: ['admin', hash, 'سكرتير النائب - معن ياسين', 'admin']
        });
        console.log('---------------------------------------------------');
        console.log('تم إنشاء حساب رئيسي افتراضي:');
        console.log('اسم المستخدم: admin');
        console.log('كلمة المرور: admin123');
        console.log('يرجى تغييرها فور الدخول من صفحة "إدارة الحسابات".');
        console.log('---------------------------------------------------');
      }

      const officeCountRs = await client.execute('SELECT COUNT(*) AS c FROM offices');
      const officeCount = Number(officeCountRs.rows[0].c);
      if (officeCount === 0) {
        const defaults = ['مكتب الشكاوى', 'مكتب الاعلام', 'السكرتارية'];
        for (const name of defaults) {
          await client.execute({ sql: 'INSERT INTO offices (name) VALUES (?)', args: [name] });
        }
      }
    })();
  }
  return readyPromise;
}

// ---------- طبقة توافق شبيهة بـ better-sqlite3 لكن غير-متزامنة (Promise) ----------
// get(sql, ...args) -> صف واحد أو undefined
// all(sql, ...args) -> مصفوفة صفوف
// run(sql, ...args) -> { lastInsertRowid, changes }
async function get(sql, ...args) {
  await ready();
  const rs = await client.execute({ sql, args });
  return rs.rows[0] ? { ...rs.rows[0] } : undefined;
}

async function all(sql, ...args) {
  await ready();
  const rs = await client.execute({ sql, args });
  return rs.rows.map(r => ({ ...r }));
}

async function run(sql, ...args) {
  await ready();
  const rs = await client.execute({ sql, args });
  return {
    lastInsertRowid: rs.lastInsertRowid !== undefined && rs.lastInsertRowid !== null ? Number(rs.lastInsertRowid) : null,
    changes: rs.rowsAffected
  };
}

module.exports = { client, ready, get, all, run };
