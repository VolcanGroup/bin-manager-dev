const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// La URL de conexión se tomará de una variable de entorno en el servidor (Render)
const connectionString = process.env.DATABASE_URL;

let pool = null;

async function initDatabase() {
  if (pool) return pool;

  pool = new Pool({
    connectionString: connectionString,
    ssl: {
      rejectUnauthorized: false // Requerido para la mayoría de nubes (Supabase, Render)
    }
  });

  const client = await pool.connect();
  try {
    // ========== Tablas (Sintaxis PostgreSQL) ==========

    // Users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT,
        role TEXT DEFAULT 'viewer',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // BINs
    await client.query(`
      CREATE TABLE IF NOT EXISTS bins (
        id SERIAL PRIMARY KEY,
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
        segment TEXT,
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Embossers
    await client.query(`
      CREATE TABLE IF NOT EXISTS embossers (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Requests
    await client.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id SERIAL PRIMARY KEY,
        requester_id INTEGER NOT NULL,
        requester_username TEXT NOT NULL,
        country TEXT,
        ica TEXT,
        ica_qmr TEXT,
        digits INTEGER NOT NULL,
        brand TEXT,
        product TEXT,
        client TEXT,
        segment TEXT,
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (requester_id) REFERENCES users(id),
        FOREIGN KEY (proposed_bin_id) REFERENCES bins(id) ON DELETE SET NULL
      )
    `);

    // Migration: Update existing FK constraint to use ON DELETE SET NULL
    await client.query(`
      ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_proposed_bin_id_fkey;
      ALTER TABLE requests ADD CONSTRAINT requests_proposed_bin_id_fkey 
      FOREIGN KEY (proposed_bin_id) REFERENCES bins(id) ON DELETE SET NULL;
    `).catch(() => { /* skip if fails */ });

    // Audit Log
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        username TEXT,
        action TEXT NOT NULL,
        table_name TEXT,
        record_id INTEGER,
        field TEXT,
        old_value TEXT,
        new_value TEXT,
        details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Countries
    await client.query(`
      CREATE TABLE IF NOT EXISTS countries (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Índices
    await client.query('CREATE INDEX IF NOT EXISTS idx_bins_bin_number ON bins(bin_number)');

    // Default admin user
    const resAdmin = await client.query('SELECT id FROM users WHERE username = $1', ['admin']);
    if (resAdmin.rows.length === 0) {
      const hash = bcrypt.hashSync('admin123', 10);
      await client.query('INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, $2, $3, $4)',
        ['admin', hash, 'Administrador', 'admin']);
      console.log('✓ Default admin user created (admin / admin123)');
    }

    // Seed Countries si está vacío
    const resCountry = await client.query('SELECT COUNT(*) as c FROM countries');
    if (parseInt(resCountry.rows[0].c) === 0) {
      const defaultCountries = ['Guatemala', 'El Salvador', 'Honduras', 'Nicaragua', 'Costa Rica', 'Panamá', 'México', 'República Dominicana'];
      for (const c of defaultCountries) {
        await client.query('INSERT INTO countries (name) VALUES ($1) ON CONFLICT DO NOTHING', [c]);
      }
      console.log('✓ Default countries seeded');
    }

    // Seed Embossers (Defaults + Existing Bins)
    const resEmbosser = await client.query('SELECT COUNT(*) as c FROM embossers');
    const defaultEmbossers = ['MyCard', 'Forza', 'Idemia', 'Plasticard', 'Banet'];
    
    // Always ensure defaults are there
    for (const e of defaultEmbossers) {
      await client.query('INSERT INTO embossers (name) VALUES ($1) ON CONFLICT DO NOTHING', [e]);
    }

    // Also sync from existing bins if table was totally empty before
    if (parseInt(resEmbosser.rows[0].c) === 0) {
      const distinctEmbossers = await client.query("SELECT DISTINCT embosser FROM bins WHERE embosser IS NOT NULL AND embosser != ''");
      for (const row of distinctEmbossers.rows) {
        await client.query('INSERT INTO embossers (name) VALUES ($1) ON CONFLICT DO NOTHING', [row.embosser]);
      }
      console.log('✓ Embossers seeded (Defaults + Bins)');
    }

  } finally {
    client.release();
  }

  return pool;
}

// Helpers adaptados para PostgreSQL
function translateSql(sql) {
  let pgSql = sql;
  
  // Convertir datetime('now', 'localtime') a CURRENT_TIMESTAMP
  pgSql = pgSql.replace(/datetime\(['"]now['"]\s*,\s*['"]localtime['"]\)/gi, 'CURRENT_TIMESTAMP');
  pgSql = pgSql.replace(/datetime\(['"]now['"]\)/gi, 'CURRENT_TIMESTAMP');

  // La lógica de reemplazo de ? por $1, $2... es más compleja si hay strings con '?'
  // pero para este proyecto simple donde no hay binds complejos, un replace global secuencial funciona:
  let parts = pgSql.split('?');
  if (parts.length > 1) {
    pgSql = parts[0];
    for (let i = 1; i < parts.length; i++) {
        pgSql += '$' + i + parts[i];
    }
  }
  
  return pgSql;
}

async function queryAll(sql, params = []) {
  const pgSql = translateSql(sql);
  const res = await pool.query(pgSql, params);
  return res.rows;
}

async function queryOne(sql, params = []) {
  const rows = await queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

async function runQuery(sql, params = []) {
  let pgSql = translateSql(sql);

  // Manejar el last_insert_rowid() de SQLite
  if (pgSql.toUpperCase().includes('INSERT INTO')) {
    // Si ya tiene RETURNING, no lo agregamos
    if (!pgSql.toUpperCase().includes('RETURNING')) {
      pgSql += ' RETURNING id';
    }
  }

  const res = await pool.query(pgSql, params);
  const lastId = res.rows.length > 0 ? res.rows[0].id : 0;
  return { lastInsertRowid: lastId, changes: res.rowCount };
}

async function logAudit(userId, username, action, tableName, recordId, field, oldValue, newValue, details) {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, username, action, table_name, record_id, field, old_value, new_value, details) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [userId || null, username || null, action, tableName || null, recordId || null, field || null,
      oldValue != null ? String(oldValue) : null, newValue != null ? String(newValue) : null, details || null]
    );
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

function saveDatabase() {
  // No-op en PostgreSQL ya que es transaccional y persistente
}

module.exports = { initDatabase, queryAll, queryOne, runQuery, saveDatabase, logAudit };
