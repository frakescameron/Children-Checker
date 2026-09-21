const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const MAX_BEEPER = 30; // beeper numbers 1-30

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Database setup ----------
const db = new Database(path.join(__dirname, 'checkin.db'));
db.pragma('journal_mode = WAL'); // safer for two "writers" hitting it around the same time

db.exec(`
  CREATE TABLE IF NOT EXISTS kids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_name TEXT NOT NULL,
    parent_name TEXT NOT NULL,
    birthday TEXT,
    parent_phone TEXT,
    address TEXT,
    notes TEXT DEFAULT '[]', -- JSON array of {id, text, flagged}
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kid_id INTEGER NOT NULL REFERENCES kids(id),
    beeper_number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'done'
    checked_in_at TEXT NOT NULL DEFAULT (datetime('now')),
    checked_out_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_checkins_status ON checkins(status);
`);

// better-sqlite3 is synchronous, and Node runs single-threaded, so every
// request below runs start-to-finish with nothing else able to interleave.
// That's what makes the beeper-number assignment safe even with two tablets
// hitting the server at nearly the same instant - there's no gap for a race.

function parseKid(row) {
  return { ...row, notes: JSON.parse(row.notes || '[]') };
}

// ---------- Kid roster (saved, reusable kids) ----------

app.get('/api/kids', (req, res) => {
  const rows = db.prepare('SELECT * FROM kids ORDER BY child_name COLLATE NOCASE').all();
  res.json(rows.map(parseKid));
});

app.post('/api/kids', (req, res) => {
  const { childName, parentName, birthday, parentPhone, address, notes } = req.body;
  if (!childName || !childName.trim() || !parentName || !parentName.trim()) {
    return res.status(400).json({ error: 'Child name and parent name are required.' });
  }
  const cleanNotes = Array.isArray(notes)
    ? notes
        .filter(n => n && n.text && n.text.trim())
        .map((n, i) => ({ id: `${Date.now()}-${i}`, text: n.text.trim(), flagged: !!n.flagged }))
    : [];

  const stmt = db.prepare(`
    INSERT INTO kids (child_name, parent_name, birthday, parent_phone, address, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    childName.trim(),
    parentName.trim(),
    birthday || null,
    parentPhone || null,
    address || null,
    JSON.stringify(cleanNotes)
  );
  const kid = parseKid(db.prepare('SELECT * FROM kids WHERE id = ?').get(info.lastInsertRowid));
  io.emit('kids:changed');
  res.status(201).json(kid);
});

app.put('/api/kids/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM kids WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Kid not found.' });

  const { childName, parentName, birthday, parentPhone, address, notes } = req.body;
  if (!childName || !childName.trim() || !parentName || !parentName.trim()) {
    return res.status(400).json({ error: 'Child name and parent name are required.' });
  }
  const cleanNotes = Array.isArray(notes)
    ? notes
        .filter(n => n && n.text && n.text.trim())
        .map((n, i) => ({ id: n.id || `${Date.now()}-${i}`, text: n.text.trim(), flagged: !!n.flagged }))
    : [];

  db.prepare(`
    UPDATE kids SET child_name=?, parent_name=?, birthday=?, parent_phone=?, address=?, notes=?, updated_at=datetime('now')
    WHERE id=?
  `).run(childName.trim(), parentName.trim(), birthday || null, parentPhone || null, address || null, JSON.stringify(cleanNotes), id);

  const kid = parseKid(db.prepare('SELECT * FROM kids WHERE id = ?').get(id));
  io.emit('kids:changed');
  res.json(kid);
});

app.delete('/api/kids/:id', (req, res) => {
  const { id } = req.params;
  const active = db.prepare(`SELECT * FROM checkins WHERE kid_id = ? AND status = 'active'`).get(id);
  if (active) return res.status(400).json({ error: 'This child is currently checked in. Check them out first.' });
  db.prepare('DELETE FROM kids WHERE id = ?').run(id);
  io.emit('kids:changed');
  res.json({ ok: true });
});

// ---------- Check-in / check-out ----------

// Returns the current hub state: everyone actively checked in, with kid info + beeper number.
function getActiveCheckins() {
  const rows = db.prepare(`
    SELECT c.id as checkin_id, c.beeper_number, c.checked_in_at,
           k.id as kid_id, k.child_name, k.parent_name, k.birthday, k.parent_phone, k.address, k.notes
    FROM checkins c
    JOIN kids k ON k.id = c.kid_id
    WHERE c.status = 'active'
    ORDER BY c.beeper_number ASC
  `).all();
  return rows.map(r => ({
    checkinId: r.checkin_id,
    beeperNumber: r.beeper_number,
    checkedInAt: r.checked_in_at,
    kidId: r.kid_id,
    childName: r.child_name,
    parentName: r.parent_name,
    birthday: r.birthday,
    parentPhone: r.parent_phone,
    address: r.address,
    notes: JSON.parse(r.notes || '[]'),
  }));
}

app.get('/api/checkins', (req, res) => {
  res.json(getActiveCheckins());
});

// Check a kid in: assigns the LOWEST available beeper number 1-30.
app.post('/api/checkins', (req, res) => {
  const { kidId } = req.body;
  const kid = db.prepare('SELECT * FROM kids WHERE id = ?').get(kidId);
  if (!kid) return res.status(404).json({ error: 'Kid not found.' });

  const already = db.prepare(`SELECT * FROM checkins WHERE kid_id = ? AND status = 'active'`).get(kidId);
  if (already) return res.status(400).json({ error: `${kid.child_name} is already checked in with beeper #${already.beeper_number}.` });

  const usedNumbers = new Set(
    db.prepare(`SELECT beeper_number FROM checkins WHERE status = 'active'`).all().map(r => r.beeper_number)
  );

  if (usedNumbers.size >= MAX_BEEPER) {
    return res.status(409).json({ error: `All ${MAX_BEEPER} beepers are currently in use.` });
  }

  let beeperNumber = null;
  for (let n = 1; n <= MAX_BEEPER; n++) {
    if (!usedNumbers.has(n)) { beeperNumber = n; break; }
  }

  const info = db.prepare(`
    INSERT INTO checkins (kid_id, beeper_number, status) VALUES (?, ?, 'active')
  `).run(kidId, beeperNumber);

  const result = {
    checkinId: info.lastInsertRowid,
    beeperNumber,
    kidId: kid.id,
    childName: kid.child_name,
    parentName: kid.parent_name,
    notes: JSON.parse(kid.notes || '[]'),
  };

  io.emit('checkins:changed');
  res.status(201).json(result);
});

// Check a kid out: frees their beeper number back into the pool.
app.post('/api/checkins/:checkinId/checkout', (req, res) => {
  const { checkinId } = req.params;
  const checkin = db.prepare(`SELECT * FROM checkins WHERE id = ? AND status = 'active'`).get(checkinId);
  if (!checkin) return res.status(404).json({ error: 'Active check-in not found.' });

  db.prepare(`UPDATE checkins SET status='done', checked_out_at=datetime('now') WHERE id=?`).run(checkinId);
  io.emit('checkins:changed');
  res.json({ ok: true });
});

// ---------- Socket.io: just tells tablets "something changed, go re-fetch" ----------
io.on('connection', (socket) => {
  socket.on('disconnect', () => {});
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    }
  }
  console.log('\n=== Rock Church Kids Check-In Server ===');
  console.log(`Running on port ${PORT}`);
  console.log('\nOn THIS device, open:');
  console.log(`  http://localhost:${PORT}`);
  console.log('\nOn the OTHER tablet (same wifi), open:');
  if (addresses.length) {
    addresses.forEach(a => console.log(`  http://${a}:${PORT}`));
  } else {
    console.log('  (Could not detect a network IP - check this device is on wifi)');
  }
  console.log('==========================================\n');
});
