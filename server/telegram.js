// telegram.js — إرسال نسخ أرشيفية إلى بوت تلغرام (قناة أو مجموعة أو محادثة خاصة)
// يعتمد على متغيرات البيئة: TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID
// إذا لم تُضبط هذه المتغيرات، يتم تجاهل الإرسال بصمت (لا يوقف عمل التطبيق).

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function isEnabled() {
  return Boolean(TOKEN && CHAT_ID);
}

async function sendMessage(text) {
  if (!isEnabled()) return { skipped: true };
  try {
    const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'HTML'
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('Telegram sendMessage failed:', data);
    }
    return data;
  } catch (err) {
    console.error('Telegram sendMessage error:', err.message);
    return { error: err.message };
  }
}

async function sendDocument(filePath, caption) {
  if (!isEnabled()) return { skipped: true };
  try {
    const fs = require('fs');
    if (!fs.existsSync(filePath)) return { skipped: true, reason: 'file-not-found' };
    const url = `https://api.telegram.org/bot${TOKEN}/sendDocument`;
    const form = new FormData();
    form.append('chat_id', CHAT_ID);
    if (caption) form.append('caption', caption);
    const buffer = fs.readFileSync(filePath);
    const blob = new Blob([buffer]);
    form.append('document', blob, require('path').basename(filePath));
    const res = await fetch(url, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) console.error('Telegram sendDocument failed:', data);
    return data;
  } catch (err) {
    console.error('Telegram sendDocument error:', err.message);
    return { error: err.message };
  }
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function archiveNewTask(task, assignedName, officeName) {
  const text =
    `🆕 <b>مهمة جديدة</b>\n` +
    `العنوان: ${esc(task.title)}\n` +
    `المكتب صاحب الطلب: ${esc(officeName)}\n` +
    `المخول: ${esc(assignedName)}\n` +
    `تاريخ الاستحقاق: ${esc(task.due_date)}\n` +
    (task.details ? `التفاصيل: ${esc(task.details)}\n` : '') +
    `الحالة: ${esc(task.status)}`;
  await sendMessage(text);
}

async function archiveTaskUpdate(task, assignedName, officeName) {
  let statusLine = `الحالة الجديدة: ${esc(task.status)}`;
  if (task.status === 'منجز') statusLine += `\nتاريخ الإنجاز: ${esc(task.completion_date)}`;
  if (task.status === 'مرفوض') statusLine += `\nسبب الرفض: ${esc(task.rejection_reason)}`;
  const text =
    `🔄 <b>تحديث حالة مهمة</b>\n` +
    `العنوان: ${esc(task.title)}\n` +
    `المكتب صاحب الطلب: ${esc(officeName)}\n` +
    `المخول: ${esc(assignedName)}\n` +
    statusLine;
  await sendMessage(text);
}

module.exports = { isEnabled, sendMessage, sendDocument, archiveNewTask, archiveTaskUpdate };
