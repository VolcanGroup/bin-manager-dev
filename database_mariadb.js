const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const connectionString = process.env.MARIADB_URI;

let pool = null;

async function initDatabase() {
  if (pool) return pool;

  pool = mysql.createPool({
    uri: connectionString,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: true
  });

  const client = await pool.getConnection();
  try {
    // Users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT,
        email VARCHAR(255),
        role VARCHAR(50) DEFAULT 'viewer',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    try {
      await client.query("ALTER TABLE users ADD COLUMN email VARCHAR(255)");
      console.log('✓ Migrated: added email to users (MariaDB)');
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') {
        console.error('Migration error for email column:', e.message);
      }
    }

    // BINs
    await client.query(`
      CREATE TABLE IF NOT EXISTS bins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        country VARCHAR(255),
        ica VARCHAR(255),
        ica_qmr VARCHAR(255),
        bin_number VARCHAR(255) NOT NULL UNIQUE,
        bin_length INT NOT NULL,
        parent_bin VARCHAR(255),
        status VARCHAR(50) DEFAULT 'available',
        brand VARCHAR(255),
        product VARCHAR(255),
        client VARCHAR(255),
        segment VARCHAR(255),
        tokenization VARCHAR(255),
        \`keys\` VARCHAR(255),
        embosser VARCHAR(255),
        bin_type VARCHAR(255),
        balance_type VARCHAR(255),
        notes TEXT,
        assigned_date VARCHAR(255),
        requested_by VARCHAR(255),
        approved_by VARCHAR(255),
        first_segmentation INT DEFAULT 0,
        bin_tokenizado VARCHAR(5) DEFAULT 'No',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Embossers
    await client.query(`
      CREATE TABLE IF NOT EXISTS embossers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Requests
    await client.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        requester_id INT NOT NULL,
        requester_username VARCHAR(255) NOT NULL,
        country VARCHAR(255),
        ica VARCHAR(255),
        ica_qmr VARCHAR(255),
        digits INT NOT NULL,
        brand VARCHAR(255),
        product VARCHAR(255),
        client VARCHAR(255),
        segment VARCHAR(255),
        tokenization VARCHAR(255),
        \`keys\` VARCHAR(255),
        embosser VARCHAR(255),
        bin_type VARCHAR(255),
        balance_type VARCHAR(255),
        proposed_bin VARCHAR(255),
        proposed_bin_id INT,
        status VARCHAR(50) DEFAULT 'pending',
        admin_id INT,
        admin_username VARCHAR(255),
        admin_action_date VARCHAR(255),
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (requester_id) REFERENCES users(id),
        FOREIGN KEY (proposed_bin_id) REFERENCES bins(id) ON DELETE SET NULL
      )
    `);

    // Audit Log
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        username VARCHAR(255),
        action VARCHAR(255) NOT NULL,
        table_name VARCHAR(255),
        record_id INT,
        field VARCHAR(255),
        old_value TEXT,
        new_value TEXT,
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Countries
    await client.query(`
      CREATE TABLE IF NOT EXISTS countries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Default admin user
    const [resAdmin] = await client.query('SELECT id FROM users WHERE username = ?', ['admin']);
    if (resAdmin.length === 0) {
      const hash = bcrypt.hashSync('admin123', 10);
      await client.query('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
        ['admin', hash, 'Administrador', 'admin']);
      console.log('✓ Default admin user created (admin / admin123)');
    }

    // Seed Countries if empty
    const [resCountry] = await client.query('SELECT COUNT(*) as c FROM countries');
    if (parseInt(resCountry[0].c) === 0) {
      const defaultCountries = ['Guatemala', 'El Salvador', 'Honduras', 'Nicaragua', 'Costa Rica', 'Panamá', 'México', 'República Dominicana'];
      for (const c of defaultCountries) {
        await client.query('INSERT IGNORE INTO countries (name) VALUES (?)', [c]);
      }
      console.log('✓ Default countries seeded');
    }

    // Seed Embossers
    const [resEmbosser] = await client.query('SELECT COUNT(*) as c FROM embossers');
    const defaultEmbossers = ['MyCard', 'Forza', 'Idemia', 'Plasticard', 'Banet'];
    
    for (const e of defaultEmbossers) {
      await client.query('INSERT IGNORE INTO embossers (name) VALUES (?)', [e]);
    }

    if (parseInt(resEmbosser[0].c) === 0) {
      const [distinctEmbossers] = await client.query("SELECT DISTINCT embosser FROM bins WHERE embosser IS NOT NULL AND embosser != ''");
      for (const row of distinctEmbossers) {
        await client.query('INSERT IGNORE INTO embossers (name) VALUES (?)', [row.embosser]);
      }
      console.log('✓ Embossers seeded (Defaults + Bins)');
    }

  } catch (err) {
    console.error('Migration DB Init Error:', err);
  } finally {
    client.release();
  }

  return pool;
}

function translateSql(sql) {
  let pgSql = sql;
  // Convert sqlite datetime('now','localtime') to CURRENT_TIMESTAMP
  pgSql = pgSql.replace(/datetime\(['"]now['"]\s*,\s*['"]localtime['"]\)/gi, 'CURRENT_TIMESTAMP');
  pgSql = pgSql.replace(/datetime\(['"]now['"]\)/gi, 'CURRENT_TIMESTAMP');
  // ON CONFLICT DO NOTHING -> INSERT IGNORE
  pgSql = pgSql.replace(/INSERT INTO (.*?) VALUES (.*?) ON CONFLICT DO NOTHING/gi, 'INSERT IGNORE INTO $1 VALUES $2');
  return pgSql;
}

async function queryAll(sql, params = []) {
  const finalSql = translateSql(sql);
  const [rows] = await pool.query(finalSql, params);
  return rows;
}

async function queryOne(sql, params = []) {
  const rows = await queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

async function runQuery(sql, params = []) {
  const finalSql = translateSql(sql);
  
  let result;
  if (finalSql.toUpperCase().includes('INSERT INTO') && finalSql.toUpperCase().includes('RETURNING')) {
    // MariaDB 10.5+ supports RETURNING
    [result] = await pool.query(finalSql, params);
    // result behaves like SELECT returning an array
    const lastId = result.length > 0 ? result[0].id : 0;
    return { lastInsertRowid: lastId, changes: 1 };
  } else {
    [result] = await pool.query(finalSql, params);
    return { lastInsertRowid: result.insertId, changes: result.affectedRows };
  }
}

async function logAudit(userId, username, action, tableName, recordId, field, oldValue, newValue, details) {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, username, action, table_name, record_id, field, old_value, new_value, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId || null, username || null, action, tableName || null, recordId || null, field || null,
      oldValue != null ? String(oldValue) : null, newValue != null ? String(newValue) : null, details || null]
    );
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

function saveDatabase() {}

module.exports = { initDatabase, queryAll, queryOne, runQuery, saveDatabase, logAudit };
