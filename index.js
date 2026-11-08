// ==========================================
// ໄຟລ໌: setup.js (ບັນທຶກເປັນ setup.js ແລ້ວສັ່ງ: node setup.js)
// ==========================================
const fs = require('fs');
const path = require('path');

const dirs = ['views', 'backups'];
dirs.forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const files = {
  'package.json': JSON.stringify({
    "name": "buddy-matching-system",
    "version": "1.0.0",
    "main": "server.js",
    "scripts": {
      "start": "node server.js"
    },
    "dependencies": {
      "axios": "^1.7.0",
      "bcrypt": "^5.1.1",
      "better-sqlite3": "^11.0.0",
      "dotenv": "^16.4.5",
      "ejs": "^3.1.10",
      "express": "^4.19.2",
      "express-session": "^1.18.0"
    }
  }, null, 2),

  '.env': `WA_PHONE_NUMBER_ID=YOUR_PHONE_NUMBER_ID\nWA_ACCESS_TOKEN=YOUR_META_PERMANENT_ACCESS_TOKEN`,

  'server.js': `require('dotenv').config();
const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const db = new Database('database.sqlite');

const WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID || 'YOUR_PHONE_NUMBER_ID';
const WA_ACCESS_TOKEN = process.env.WA_ACCESS_TOKEN || 'YOUR_META_PERMANENT_ACCESS_TOKEN';

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.use(session({
    secret: 'buddy_secret_key_lao_2026',
    resave: false,
    saveUninitialized: false
}));

if (!fs.existsSync('./backups')) {
    fs.mkdirSync('./backups');
}

db.exec(\`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    year INTEGER NOT NULL,
    whatsapp TEXT NOT NULL,
    clue TEXT,
    access_code TEXT UNIQUE,
    group_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS whatsapp_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_name TEXT,
    recipient_whatsapp TEXT,
    message TEXT,
    status TEXT,
    error_msg TEXT,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT,
    performed_by TEXT,
    details TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
\`);

const defaultAdminPass = bcrypt.hashSync('admin1234', 10);
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_password', ?)").run(defaultAdminPass);
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('clues_visible', '0')").run();

function requireAdmin(req, res, next) {
    if (req.session.isAdmin) return next();
    res.redirect('/admin/login');
}

function generateAccessCode() {
    return 'B' + Math.floor(10000 + Math.random() * 90000);
}

app.get('/', (req, res) => {
    res.render('index', { success: req.query.success, accessCode: req.query.code });
});

app.post('/register', (req, res) => {
    const { name, year, whatsapp, clue } = req.body;
    const cleanPhone = whatsapp.replace(/[^0-9]/g, '');

    let accessCode = null;
    if (parseInt(year) === 1) {
        accessCode = generateAccessCode();
    }

    try {
        db.prepare(\`
            INSERT INTO users (name, year, whatsapp, clue, access_code)
            VALUES (?, ?, ?, ?, ?)
        \`).run(name, parseInt(year), cleanPhone, clue || null, accessCode);

        res.redirect(\`/?success=1&code=\${accessCode || ''}\`);
    } catch (err) {
        res.status(500).send("ເກີດຂໍ້ຜິດພາດ: " + err.message);
    }
});

app.get('/my-clues', (req, res) => {
    const isVisible = db.prepare("SELECT value FROM settings WHERE key = 'clues_visible'").get().value === '1';
    res.render('check-clue', { isVisible, clues: null, error: null, studentName: null });
});

app.post('/my-clues', (req, res) => {
    const isVisible = db.prepare("SELECT value FROM settings WHERE key = 'clues_visible'").get().value === '1';
    if (!isVisible) {
        return res.render('check-clue', { isVisible, clues: null, error: 'ລະບົບຍັງບໍ່ທັນເປີດໃຫ້ເບິ່ງຄຳໃບ້ໃນເວລານີ້', studentName: null });
    }

    const { access_code } = req.body;
    const junior = db.prepare("SELECT * FROM users WHERE access_code = ? AND year = 1").get(access_code.trim());

    if (!junior) {
        return res.render('check-clue', { isVisible, clues: null, error: 'ບໍ່ພົບລະຫັດປະຈຳຕົວນີ້ໃນລະບົບ', studentName: null });
    }

    if (!junior.group_id) {
        return res.render('check-clue', { isVisible, clues: null, error: 'ລະບົບຍັງບໍ່ທັນໄດ້ສຸ່ມຈັບຄູ່ສາຍລະຫັດ', studentName: null });
    }

    const seniorsClues = db.prepare(\`
        SELECT year, clue FROM users 
        WHERE group_id = ? AND year > 1
    \`).all(junior.group_id);

    res.render('check-clue', { isVisible, clues: seniorsClues, error: null, studentName: junior.name });
});

app.get('/admin/login', (req, res) => {
    res.render('admin-login', { error: null });
});

app.post('/admin/login', (req, res) => {
    const { password } = req.body;
    const hash = db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").get().value;
    
    if (bcrypt.compareSync(password, hash)) {
        req.session.isAdmin = true;
        req.session.adminUser = 'Owner Admin';
        return res.redirect('/admin');
    }
    res.render('admin-login', { error: 'ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ!' });
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

app.get('/admin', requireAdmin, (req, res) => {
    const users = db.prepare("SELECT * FROM users ORDER BY group_id ASC, year ASC").all();
    const cluesVisible = db.prepare("SELECT value FROM settings WHERE key = 'clues_visible'").get().value === '1';
    const auditLogs = db.prepare("SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 10").all();
    const waLogs = db.prepare("SELECT * FROM whatsapp_logs ORDER BY sent_at DESC LIMIT 15").all();

    const groups = {};
    users.forEach(u => {
        if (u.group_id) {
            if (!groups[u.group_id]) groups[u.group_id] = { junior: null, seniors: [] };
            if (u.year === 1) groups[u.group_id].junior = u;
            else groups[u.group_id].seniors.push(u);
        }
    });

    res.render('admin', { users, groups, cluesVisible, auditLogs, waLogs });
});

app.post('/admin/match', requireAdmin, (req, res) => {
    const juniors = db.prepare("SELECT * FROM users WHERE year = 1").all();
    const seniors = db.prepare("SELECT * FROM users WHERE year > 1").all();

    if (juniors.length === 0 || seniors.length === 0) {
        return res.send("<script>alert('ຈຳນວນຮຸ່ນນ້ອງ ຫຼື ຮຸ່ນອ້າຍບໍ່ພຽງພໍທີ່ຈະຈັບຄູ່'); window.location='/admin';</script>");
    }

    const shuffle = (array) => {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    };

    shuffle(juniors);
    shuffle(seniors);

    db.prepare("UPDATE users SET group_id = NULL").run();

    let groupId = 1;
    const groups = [];

    for (let i = 0; i < juniors.length; i++) {
        groups.push({
            id: groupId++,
            junior: juniors[i],
            seniors: []
        });
    }

    let seniorIdx = 0;
    for (let i = 0; i < groups.length && seniorIdx < seniors.length; i++) {
        groups[i].seniors.push(seniors[seniorIdx++]);
    }

    for (let i = 0; i < groups.length && seniorIdx < seniors.length; i++) {
        if (groups[i].seniors.length < 2) {
            groups[i].seniors.push(seniors[seniorIdx++]);
        }
    }

    const updateStmt = db.prepare("UPDATE users SET group_id = ? WHERE id = ?");
    const runTx = db.transaction(() => {
        groups.forEach(g => {
            updateStmt.run(g.id, g.junior.id);
            g.seniors.forEach(s => updateStmt.run(g.id, s.id));
        });
    });
    runTx();

    db.prepare("INSERT INTO audit_logs (action, performed_by, details) VALUES (?, ?, ?)")
      .run('RANDOM_MATCHING', req.session.adminUser, \`ສຸ່ມຈັບຄູ່ສຳເລັດຈຳນວນ \${groups.length} ກຸ່ມ\`);

    res.redirect('/admin');
});

app.post('/admin/toggle-clues', requireAdmin, (req, res) => {
    const current = db.prepare("SELECT value FROM settings WHERE key = 'clues_visible'").get().value;
    const nextVal = current === '1' ? '0' : '1';
    db.prepare("UPDATE settings SET value = ? WHERE key = 'clues_visible'").run(nextVal);

    db.prepare("INSERT INTO audit_logs (action, performed_by, details) VALUES (?, ?, ?)")
      .run('TOGGLE_CLUES', req.session.adminUser, \`ປ່ຽນສະຖານະການເບິ່ງຄຳໃບ້ເປັນ: \${nextVal === '1' ? 'ເປີດ' : 'ປິດ'}\`);

    res.redirect('/admin');
});

app.post('/admin/reset', requireAdmin, (req, res) => {
    const { reset_type } = req.body;
    const backupData = {
        users: db.prepare("SELECT * FROM users").all(),
        settings: db.prepare("SELECT * FROM settings").all(),
        backup_date: new Date().toISOString()
    };
    const backupFileName = \`./backups/backup-\${Date.now()}.json\`;
    fs.writeFileSync(backupFileName, JSON.stringify(backupData, null, 2));

    if (reset_type === 'pairings_only') {
        db.prepare("UPDATE users SET group_id = NULL").run();
        db.prepare("INSERT INTO audit_logs (action, performed_by, details) VALUES (?, ?, ?)")
          .run('RESET_PAIRINGS', req.session.adminUser, \`ລ້າງສະເພາະການຈັບຄູ່, Backup ໄວ້ທີ່: \${backupFileName}\`);
    } else if (reset_type === 'all_data') {
        db.prepare("DELETE FROM users").run();
        db.prepare("DELETE FROM whatsapp_logs").run();
        db.prepare("UPDATE settings SET value = '0' WHERE key = 'clues_visible'").run();
        db.prepare("INSERT INTO audit_logs (action, performed_by, details) VALUES (?, ?, ?)")
          .run('RESET_ALL', req.session.adminUser, \`ລ້າງຂໍ້ມູນທັງໝົດໃນລະບົບ, Backup ໄວ້ທີ່: \${backupFileName}\`);
    }

    res.redirect('/admin');
});

async function sendWhatsAppMessage(recipientPhone, messageText, recipientName) {
    try {
        await axios.post(
            \`https://graph.facebook.com/v20.0/\${WA_PHONE_NUMBER_ID}/messages\`,
            {
                messaging_product: "whatsapp",
                to: recipientPhone,
                type: "text",
                text: { body: messageText }
            },
            {
                headers: {
                    'Authorization': \`Bearer \${WA_ACCESS_TOKEN}\`,
                    'Content-Type': 'application/json'
                }
            }
        );

        db.prepare(\`
            INSERT INTO whatsapp_logs (recipient_name, recipient_whatsapp, message, status, error_msg)
            VALUES (?, ?, ?, 'SUCCESS', NULL)
        \`).run(recipientName, recipientPhone, messageText);
        return { success: true };
    } catch (error) {
        const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        db.prepare(\`
            INSERT INTO whatsapp_logs (recipient_name, recipient_whatsapp, message, status, error_msg)
            VALUES (?, ?, ?, 'FAILED', ?)
        \`).run(recipientName, recipientPhone, messageText, errorMsg);
        return { success: false, error: errorMsg };
    }
}

app.post('/admin/send-whatsapp-all', requireAdmin, async (req, res) => {
    const juniors = db.prepare("SELECT * FROM users WHERE year = 1 AND group_id IS NOT NULL").all();

    for (const junior of juniors) {
        const seniors = db.prepare("SELECT clue, year FROM users WHERE group_id = ? AND year > 1").all(junior.group_id);
        const clueLines = seniors.map((s, idx) => \`ຄຳໃບ້ທີ \${idx + 1} (ອ້າຍ/ເອື້ອຍ ປີ \${s.year}): "\${s.clue}"\`).join("\\n");

        const msg = \`ສະບາຍດີນ້ອງ \${junior.name}!\\nລະຫັດກວດສອບຄຳໃບ້ຂອງນ້ອງແມ່ນ: \${junior.access_code}\\n\\nຄຳໃບ້ສາຍລະຫັດຂອງນ້ອງ:\\n\${clueLines}\\n\\nສາມາດນຳລະຫັດໄປກວດເບິ່ງໃນເວັບໄດ້ຕະຫຼອດເວລາ!\`;
        await sendWhatsAppMessage(junior.whatsapp, msg, junior.name);
    }

    res.redirect('/admin');
});

app.post('/admin/retry-whatsapp/:id', requireAdmin, async (req, res) => {
    const log = db.prepare("SELECT * FROM whatsapp_logs WHERE id = ?").get(req.params.id);
    if (log) {
        await sendWhatsAppMessage(log.recipient_whatsapp, log.message, log.recipient_name);
    }
    res.redirect('/admin');
});

app.listen(3000, () => {
    console.log("Server is running on http://localhost:3000");
});`,

  'views/index.ejs': `<!DOCTYPE html>
<html lang="lo">
<head>
    <meta charset="UTF-8">
    <title>ລົງທະບຽນກິດຈະກຳບັດດີ້</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Lao:wght@400;600;700&display=swap" rel="stylesheet">
    <style>body { font-family: 'Noto Sans Lao', sans-serif; }</style>
</head>
<body class="bg-slate-100 min-h-screen py-10 px-4">
    <div class="max-w-lg mx-auto bg-white p-8 rounded-2xl shadow-xl">
        <h1 class="text-2xl font-bold text-center text-indigo-700 mb-2">ລົງທະບຽນກິດຈະກຳບັດດີ້ຮັບນ້ອງ</h1>
        <p class="text-center text-gray-500 mb-6 text-sm">ກະລຸນາປ້ອນຂໍ້ມູນຕົວຈິງເພື່ອໃຊ້ໃນການຈັບຄູ່</p>

        <% if (success) { %>
            <div class="mb-6 p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-800 text-center">
                <p class="font-bold">ລົງທະບຽນສຳເລັດແລ້ວ!</p>
                <% if (accessCode) { %>
                    <p class="mt-2 text-sm text-gray-600">ລະຫັດສ່ວນຕົວສຳລັບນ້ອງປີ 1 (ກະລຸນາຈົດໄວ້):</p>
                    <div class="text-2xl font-black text-indigo-600 mt-1 tracking-widest bg-white py-2 rounded-lg border border-indigo-100"><%= accessCode %></div>
                <% } %>
            </div>
        <% } %>

        <form action="/register" method="POST" class="space-y-4">
            <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">ຊື່ ແລະ ນາມສະກຸນ</label>
                <input type="text" name="name" required class="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none" placeholder="ປ້ອນຊື່ຫຼິ້ນ ຫຼື ຊື່ແທ້">
            </div>

            <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">ຊັ້ນປີ</label>
                <select name="year" id="yearSelect" onchange="toggleClueInput()" class="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                    <option value="1">ປີ 1 (ຮຸ່ນນ້ອງ)</option>
                    <option value="2">ປີ 2 (ຮຸ່ນອ້າຍ)</option>
                    <option value="3">ປີ 3 (ຮຸ່ນອ້າຍ)</option>
                    <option value="4">ປີ 4 (ຮຸ່ນອ້າຍ)</option>
                </select>
            </div>

            <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">ເບີ WhatsApp (ພ້ອມລະຫັດປະເທດ ເຊັ່ນ: 85620XXXXXXXX)</label>
                <input type="text" name="whatsapp" required class="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none" placeholder="85620...">
            </div>

            <div id="clueField" class="hidden">
                <label class="block text-sm font-semibold text-gray-700 mb-1">ຄຳໃບ້ສຳລັບຮຸ່ນນ້ອງ (ສະເພາະປີ 2-4)</label>
                <textarea name="clue" id="clueInput" rows="3" class="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none" placeholder="ໃສ່ຄຳໃບ້ທີ່ເປັນເອກະລັກຂອງຕົນເອງ..."></textarea>
            </div>

            <button type="submit" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow-lg transition duration-200">
                ຢືນຢັນການລົງທະບຽນ
            </button>
        </form>

        <div class="mt-6 text-center">
            <a href="/my-clues" class="text-sm font-semibold text-indigo-600 hover:underline">🔍 ນ້ອງປີ 1 ກວດເບິ່ງຄຳໃບ້ກົດບ່ອນນີ້</a>
        </div>
    </div>

    <script>
        function toggleClueInput() {
            const year = document.getElementById('yearSelect').value;
            const clueField = document.getElementById('clueField');
            const clueInput = document.getElementById('clueInput');
            if (year === '1') {
                clueField.classList.add('hidden');
                clueInput.removeAttribute('required');
            } else {
                clueField.classList.remove('hidden');
                clueInput.setAttribute('required', 'required');
            }
        }
    </script>
</body>
</html>`,

  'views/check-clue.ejs': `<!DOCTYPE html>
<html lang="lo">
<head>
    <meta charset="UTF-8">
    <title>ກວດສອບຄຳໃບ້ບັດດີ້</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Lao:wght@400;600;700&display=swap" rel="stylesheet">
    <style>body { font-family: 'Noto Sans Lao', sans-serif; }</style>
</head>
<body class="bg-slate-100 min-h-screen py-10 px-4">
    <div class="max-w-md mx-auto bg-white p-8 rounded-2xl shadow-xl">
        <h1 class="text-2xl font-bold text-center text-indigo-700 mb-4">🔍 My Buddy Clues</h1>

        <% if (!isVisible) { %>
            <div class="p-4 bg-amber-50 border border-amber-300 rounded-xl text-amber-800 text-center">
                🔒 ລະບົບຍັງບໍ່ທັນເປີດໃຫ້ເບິ່ງຄຳໃບ້ເທື່ອ ກະລຸນາລໍຖ້າການປະກາດຈາກແອດມິນ
            </div>
        <% } else { %>
            <form action="/my-clues" method="POST" class="space-y-4 mb-6">
                <div>
                    <label class="block text-sm font-semibold text-gray-700 mb-1">ລະຫັດສ່ວນຕົວ (PIN)</label>
                    <input type="text" name="access_code" required placeholder="ຕົວຢ່າງ: B12345" class="w-full px-4 py-2 border rounded-xl text-center font-bold tracking-widest focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                </div>
                <button type="submit" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl transition">
                    ເບິ່ງຄຳໃບ້ຂອງຂ້ອຍ
                </button>
            </form>

            <% if (error) { %>
                <div class="p-3 bg-rose-50 border border-rose-300 rounded-xl text-rose-700 text-sm text-center">
                    <%= error %>
                </div>
            <% } %>

            <% if (clues && clues.length > 0) { %>
                <div class="mt-6 border-t pt-4">
                    <h3 class="font-bold text-gray-800 mb-3 text-center">ສະບາຍດີນ້ອງ <%= studentName %>! ນີ້ແມ່ນຄຳໃບ້ຂອງເຈົ້າ:</h3>
                    <div class="space-y-3">
                        <% clues.forEach((c) => { %>
                            <div class="p-4 bg-indigo-50 border border-indigo-200 rounded-xl">
                                <span class="text-xs font-bold px-2 py-0.5 bg-indigo-200 text-indigo-800 rounded">ອ້າຍ/ເອື້ອຍ ປີ <%= c.year %></span>
                                <p class="text-gray-800 font-medium text-lg mt-2">"<%= c.clue %>"</p>
                            </div>
                        <% }) %>
                    </div>
                </div>
            <% } %>
        <% } %>

        <div class="mt-6 text-center">
            <a href="/" class="text-sm text-gray-500 hover:underline">← ກັບໄປໜ້າລົງທະບຽນ</a>
        </div>
    </div>
</body>
</html>`,

  'views/admin-login.ejs': `<!DOCTYPE html>
<html lang="lo">
<head>
    <meta charset="UTF-8">
    <title>ເຂົ້າສູ່ລະບົບແອດມິນ</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Lao:wght@400;600;700&display=swap" rel="stylesheet">
    <style>body { font-family: 'Noto Sans Lao', sans-serif; }</style>
</head>
<body class="bg-slate-900 min-h-screen flex items-center justify-center px-4">
    <div class="max-w-sm w-full bg-white p-8 rounded-2xl shadow-2xl">
        <h2 class="text-xl font-bold text-center text-gray-800 mb-4">ເຂົ້າສູ່ລະບົບຈັດການ (Admin)</h2>
        <% if (error) { %>
            <div class="mb-4 p-2 bg-rose-100 text-rose-700 text-xs text-center rounded"><%= error %></div>
        <% } %>
        <form action="/admin/login" method="POST" class="space-y-4">
            <div>
                <label class="block text-xs font-bold text-gray-600 uppercase mb-1">ລະຫັດຜ່ານແອດມິນ</label>
                <input type="password" name="password" required class="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none">
            </div>
            <button type="submit" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl transition">
                ເຂົ້າສູ່ລະບົບ
            </button>
        </form>
    </div>
</body>
</html>`,

  'views/admin.ejs': `<!DOCTYPE html>
<html lang="lo">
<head>
    <meta charset="UTF-8">
    <title>ແຜງຄວບຄຸມແອດມິນ</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Lao:wght@400;600;700&display=swap" rel="stylesheet">
    <style>body { font-family: 'Noto Sans Lao', sans-serif; }</style>
</head>
<body class="bg-slate-100 min-h-screen pb-20">
    <nav class="bg-indigo-800 text-white px-8 py-4 flex justify-between items-center shadow-md">
        <h1 class="text-xl font-bold">ລະບົບບໍລິຫານຈັດການບັດດີ້ (Buddy Control Center)</h1>
        <div class="flex items-center gap-4">
            <span class="text-xs bg-indigo-900 px-3 py-1.5 rounded-full">ສະຖານະ: ແອດມິນສູງສຸດ</span>
            <a href="/admin/logout" class="text-sm bg-rose-600 hover:bg-rose-700 px-3 py-1.5 rounded-lg transition">ອອກຈາກລະບົບ</a>
        </div>
    </nav>

    <div class="max-w-7xl mx-auto mt-8 px-4 space-y-6">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
                <h3 class="text-sm font-bold text-gray-500 uppercase mb-2">1. ຈັບຄູ່ສາຍລະຫັດ</h3>
                <form action="/admin/match" method="POST" onsubmit="return confirm('ທ່ານແນ່ໃຈບໍ່ວ່າຕ້ອງການສຸ່ມຈັບຄູ່ໃໝ່? ຂໍ້ມູນເກົ່າຈະຖືກປ່ຽນແທນ.')">
                    <button type="submit" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl transition">
                        🎲 ກົດສຸ່ມຈັບຄູ່ (1 ຕໍ່ ບໍ່ເກີນ 2)
                    </button>
                </form>
            </div>

            <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
                <h3 class="text-sm font-bold text-gray-500 uppercase mb-2">2. ສະຖານະການເບິ່ງຄຳໃບ້</h3>
                <form action="/admin/toggle-clues" method="POST">
                    <button type="submit" class="w-full font-bold py-2.5 rounded-xl transition <%= cluesVisible ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-emerald-600 hover:bg-emerald-700 text-white' %>">
                        <%= cluesVisible ? '🔒 ປິດການເບິ່ງຄຳໃບ້' : '🔓 ເປີດໃຫ້ນ້ອງເບິ່ງຄຳໃບ້' %>
                    </button>
                </form>
            </div>

            <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
                <h3 class="text-sm font-bold text-gray-500 uppercase mb-2">3. ສົ່ງ WhatsApp ອັດຕະໂນມັດ</h3>
                <form action="/admin/send-whatsapp-all" method="POST" onsubmit="return confirm('ລະບົບຈະສົ່ງ WhatsApp ຫາຮຸ່ນນ້ອງທຸກຄົນ ຢືນຢັນຫຼືບໍ່?')">
                    <button type="submit" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl transition">
                        📲 ສົ່ງຄຳໃບ້ຫານ້ອງປີ 1 ທຸກຄົນ
                    </button>
                </form>
            </div>

            <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
                <h3 class="text-sm font-bold text-gray-500 uppercase mb-2">4. ລ້າງຂໍ້ມູນ / ເລີ່ມຮອບໃໝ່</h3>
                <button onclick="document.getElementById('resetModal').classList.remove('hidden')" class="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-2.5 rounded-xl transition">
                    ⚠️ Reset ລະບົບ
                </button>
            </div>
        </div>

        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div class="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                <h2 class="text-lg font-bold text-gray-800">📋 ຕາຕະລາງສະເລີຍສາຍລະຫັດ (Cheat Sheet)</h2>
                <span class="text-sm text-gray-500">ທັງໝົດ <%= Object.keys(groups).length %> ກຸ່ມ</span>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="bg-slate-100 text-gray-600 text-xs uppercase">
                            <th class="p-4">ກຸ່ມ</th>
                            <th class="p-4">ນ້ອງປີ 1 (ຮຸ່ນນ້ອງ)</th>
                            <th class="p-4">ລະຫັດ PIN (ປີ 1)</th>
                            <th class="p-4">ອ້າຍ/ເອື້ອຍ ປີ 2-4 (ຮຸ່ນອ້າຍ)</th>
                            <th class="p-4">ຄຳໃບ້ທີ່ຕັ້ງໄວ້</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-200 text-sm">
                        <% if (Object.keys(groups).length === 0) { %>
                            <tr><td colspan="5" class="p-6 text-center text-gray-400">ຍັງບໍ່ມີຂໍ້ມູນການຈັບຄູ່ ກະລຸນາກົດປຸ່ມສຸ່ມຈັບຄູ່ດ້ານເທິງ</td></tr>
                        <% } %>
                        <% for (let gid in groups) { const g = groups[gid]; %>
                            <tr class="hover:bg-slate-50">
                                <td class="p-4 font-black text-indigo-600">#<%= gid %></td>
                                <td class="p-4 font-semibold text-gray-900"><%= g.junior ? g.junior.name : '-' %> (<%= g.junior ? g.junior.whatsapp : '' %>)</td>
                                <td class="p-4"><span class="px-2 py-1 bg-indigo-100 text-indigo-700 rounded font-mono font-bold"><%= g.junior ? g.junior.access_code : '-' %></span></td>
                                <td class="p-4">
                                    <% g.seniors.forEach(s => { %>
                                        <div class="font-medium text-gray-800">• <%= s.name %> (ປີ <%= s.year %>)</div>
                                    <% }) %>
                                </td>
                                <td class="p-4 text-gray-600">
                                    <% g.seniors.forEach(s => { %>
                                        <div class="italic">"<%= s.clue %>"</div>
                                    <% }) %>
                                </td>
                            </tr>
                        <% } %>
                    </tbody>
                </table>
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <h3 class="font-bold text-gray-800 mb-4">📱 ປະຫວັດການສົ່ງ WhatsApp (ຫຼ້າສຸດ 15 ລາຍການ)</h3>
                <div class="space-y-3 max-h-80 overflow-y-auto">
                    <% waLogs.forEach(log => { %>
                        <div class="p-3 bg-slate-50 rounded-xl text-xs flex justify-between items-center">
                            <div>
                                <span class="font-bold text-gray-800"><%= log.recipient_name %></span> (<%= log.recipient_whatsapp %>)
                                <div class="text-gray-400 text-[10px]"><%= log.sent_at %></div>
                            </div>
                            <div class="flex items-center gap-2">
                                <span class="px-2 py-0.5 rounded font-bold <%= log.status === 'SUCCESS' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700' %>">
                                    <%= log.status %>
                                </span>
                                <% if (log.status === 'FAILED') { %>
                                    <form action="/admin/retry-whatsapp/<%= log.id %>" method="POST">
                                        <button class="bg-slate-200 hover:bg-slate-300 text-gray-700 px-2 py-0.5 rounded text-[10px]">ສົ່ງຊ້ຳ</button>
                                    </form>
                                <% } %>
                            </div>
                        </div>
                    <% }) %>
                </div>
            </div>

            <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <h3 class="font-bold text-gray-800 mb-4">🛡️ ປະຫວັດການເຮັດວຽກຂອງລະບົບ (Audit Trail)</h3>
                <div class="space-y-3 max-h-80 overflow-y-auto">
                    <% auditLogs.forEach(log => { %>
                        <div class="p-3 bg-slate-50 rounded-xl text-xs">
                            <div class="flex justify-between font-bold text-indigo-700">
                                <span><%= log.action %></span>
                                <span class="text-gray-400 font-normal"><%= log.timestamp %></span>
                            </div>
                            <p class="text-gray-600 mt-1"><%= log.details %></p>
                            <span class="text-[10px] text-gray-400">ໂດຍ: <%= log.performed_by %></span>
                        </div>
                    <% }) %>
                </div>
            </div>
        </div>
    </div>

    <div id="resetModal" class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm hidden flex items-center justify-center p-4 z-50">
        <div class="bg-white max-w-md w-full p-6 rounded-2xl shadow-2xl">
            <h3 class="text-lg font-bold text-rose-600 mb-2">ຢືນຢັນການ Reset ຂໍ້ມູນລະບົບ</h3>
            <p class="text-sm text-gray-600 mb-4">
                * ລະບົບຈະທຳການ Backup ຂໍ້ມູນປັດຈຸບັນໄວ້ເປັນໄຟລ໌ JSON ໃນໂຟລເດີ <code>/backups</code> ໂດຍອັດຕະໂນມັດກ່ອນທຳການລຶບສະເໝີ.
            </p>
            <form action="/admin/reset" method="POST" class="space-y-4">
                <div class="space-y-2">
                    <label class="flex items-center gap-2 p-3 border rounded-xl cursor-pointer hover:bg-slate-50">
                        <input type="radio" name="reset_type" value="pairings_only" checked class="text-rose-600">
                        <span class="text-sm font-medium text-gray-800">ລ້າງສະເພາະຜົນການຈັບຄູ່ (ຂໍ້ມູນຄົນຍັງຢູ່)</span>
                    </label>
                    <label class="flex items-center gap-2 p-3 border rounded-xl cursor-pointer hover:bg-slate-50">
                        <input type="radio" name="reset_type" value="all_data" class="text-rose-600">
                        <span class="text-sm font-medium text-rose-600">ລ້າງຂໍ້ມູນທັງໝົດໃນລະບົບ (ເລີ່ມໃໝ່ແທ້)</span>
                    </label>
                </div>
                <div class="flex justify-end gap-3 mt-6">
                    <button type="button" onclick="document.getElementById('resetModal').classList.add('hidden')" class="px-4 py-2 text-gray-600 hover:bg-slate-100 rounded-xl text-sm font-bold">ຍົກເລີກ</button>
                    <button type="submit" class="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-sm font-bold shadow-md">ຢືນຢັນການລຶບ</button>
                </div>
            </form>
        </div>
    </div>
</body>
</html>`
};

for (const [filename, content] of Object.entries(files)) {
    fs.writeFileSync(filename, content, 'utf8');
}
console.log('Project generated successfully.');
  
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Web Server is running!');
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});