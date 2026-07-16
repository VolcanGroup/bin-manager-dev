const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'bins.db');
const dataDir = path.join(__dirname, 'data');

let db = null;

async function initDatabase() {
  if (db) return db;

  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    db = new SQL.Database();
  }

  // ========== Users ==========
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      role TEXT DEFAULT 'viewer',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // ========== BINs ==========
  db.run(`
    CREATE TABLE IF NOT EXISTS bins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      country TEXT,
      ica TEXT,
      ica_qmr TEXT,
      bin_number TEXT NOT NULL UNIQUE,
      bin_length INTEGER NOT NULL,
      parent_bin TEXT,
      status TEXT DEFAULT 'available',
      brand TEXT,
      product TEXT,
      client TEXT,
      tokenization TEXT,
      keys TEXT,
      embosser TEXT,
      bin_type TEXT,
      balance_type TEXT,
      notes TEXT,
      assigned_date TEXT,
      requested_by TEXT,
      approved_by TEXT,
      first_segmentation INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // ========== Embossers ==========
  db.run(`
    CREATE TABLE IF NOT EXISTS embossers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // ========== Requests ==========
  db.run(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL,
      requester_username TEXT NOT NULL,
      country TEXT,
      ica TEXT,
      ica_qmr TEXT,
      digits INTEGER NOT NULL,
      brand TEXT,
      product TEXT,
      client TEXT,
      tokenization TEXT,
      keys TEXT,
      embosser TEXT,
      bin_type TEXT,
      balance_type TEXT,
      proposed_bin TEXT,
      proposed_bin_id INTEGER,
      status TEXT DEFAULT 'pending',
      admin_id INTEGER,
      admin_username TEXT,
      admin_action_date TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (requester_id) REFERENCES users(id),
      FOREIGN KEY (proposed_bin_id) REFERENCES bins(id)
    )
  `);

  // ========== Audit Log ==========
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      table_name TEXT,
      record_id INTEGER,
      field TEXT,
      old_value TEXT,
      new_value TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // ========== Countries ==========
  db.run(`
    CREATE TABLE IF NOT EXISTS countries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // ========== Indexes ==========
  db.run('CREATE INDEX IF NOT EXISTS idx_bins_bin_number ON bins(bin_number)');
  db.run('CREATE INDEX IF NOT EXISTS idx_bins_parent_bin ON bins(parent_bin)');
  db.run('CREATE INDEX IF NOT EXISTS idx_bins_status ON bins(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_bins_brand ON bins(brand)');
  db.run('CREATE INDEX IF NOT EXISTS idx_bins_country ON bins(country)');
  db.run('CREATE INDEX IF NOT EXISTS idx_bins_bin_length ON bins(bin_length)');
  db.run('CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_requests_requester ON requests(requester_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_audit_table ON audit_log(table_name)');
  db.run('CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id)');

  // ========== Migration: add columns if missing ==========
  migrateTable('bins', 'requested_by', 'TEXT');
  migrateTable('bins', 'approved_by', 'TEXT');
  migrateTable('bins', 'balance_type', 'TEXT');
  migrateTable('bins', 'first_segmentation', 'INTEGER DEFAULT 0');
  migrateTable('bins', 'tokenization', 'TEXT');
  migrateTable('bins', 'segment', 'TEXT');
  migrateTable('requests', 'balance_type', 'TEXT');
  migrateTable('requests', 'bin_type', 'TEXT');
  migrateTable('requests', 'tokenization', 'TEXT');
  migrateTable('requests', 'segment', 'TEXT');
  migrateTable('users', 'email', 'TEXT');

  // ========== Normalization: lower() all usernames for case-insensitive login ==========
  db.run('UPDATE users SET username = LOWER(TRIM(username))');
  db.run('UPDATE requests SET requester_username = LOWER(TRIM(requester_username)), admin_username = LOWER(TRIM(admin_username))');
  db.run('UPDATE audit_log SET username = LOWER(TRIM(username))');

  // ========== Default admin user ==========
  const existingAdmin = queryOne('SELECT id FROM users WHERE username = ?', ['admin']);
  if (!existingAdmin) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.run('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
      ['admin', hash, 'Administrador', 'admin']);
    console.log('✓ Default admin user created (admin / admin123)');
  }

  // ========== Seed default countries ==========
  const countryCount = queryOne('SELECT COUNT(*) as c FROM countries').c;
  if (countryCount === 0) {
    const defaultCountries = [
      'Guatemala', 'El Salvador', 'Honduras', 'Nicaragua', 'Costa Rica', 'Panamá', 'Belice',
      'México',
      'República Dominicana', 'Puerto Rico', 'Jamaica', 'Trinidad y Tobago',
      'Bahamas', 'Barbados', 'Haití', 'Cuba', 'Curaçao', 'Aruba'
    ];
    for (const c of defaultCountries) {
      try { db.run('INSERT INTO countries (name) VALUES (?)', [c]); } catch (e) { /* dup */ }
    }
    console.log('✓ Default countries seeded');
  }

  // ========== Seed default embossers ==========
  const embosserCount = queryOne('SELECT COUNT(*) as c FROM embossers').c;
  if (embosserCount === 0) {
    const defaultEmbossers = ['MyCard', 'Forza', 'Idemia', 'Plasticard', 'Banet'];
    for (const e of defaultEmbossers) {
      try { db.run('INSERT INTO embossers (name) VALUES (?)', [e]); } catch (err) { /* dup */ }
    }
    console.log('✓ Default embossers seeded');
  }

  saveDatabase();
  return db;
}

// Safe migration helper - adds column if not present
function migrateTable(table, column, type) {
  try {
    const info = db.exec(`PRAGMA table_info(${table})`);
    if (info.length > 0) {
      const columns = info[0].values.map(row => row[1]);
      if (!columns.includes(column)) {
        db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
        console.log(`✓ Migrated: added ${column} to ${table}`);
      }
    }
  } catch (e) { /* column already exists */ }
}

// ========== Query Helpers ==========
function queryAll(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  } catch (err) {
    console.error('Query error:', sql, err.message);
    throw err;
  }
}

function queryOne(sql, params = []) {
  const results = queryAll(sql, params);
  return results.length > 0 ? results[0] : null;
}

function runQuery(sql, params = []) {
  try {
    db.run(sql, params);
    const lastId = db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] || 0;
    const changes = db.getRowsModified();
    saveDatabase();
    return { lastInsertRowid: lastId, changes };
  } catch (err) {
    console.error('Run error:', sql, err.message);
    throw err;
  }
}

// Audit log helper
function logAudit(userId, username, action, tableName, recordId, field, oldValue, newValue, details) {
  try {
    db.run(
      `INSERT INTO audit_log (user_id, username, action, table_name, record_id, field, old_value, new_value, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId || null, username || null, action, tableName || null, recordId || null, field || null,
      oldValue != null ? String(oldValue) : null, newValue != null ? String(newValue) : null, details || null]
    );
    saveDatabase();
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

function saveDatabase() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(DB_PATH, buffer);
  } catch (err) {
    console.error('Error saving database:', err.message);
  }
}

module.exports = { initDatabase, queryAll, queryOne, runQuery, saveDatabase, logAudit };
