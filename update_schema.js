const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'bins.db');
const db = new sqlite3.Database(dbPath);

console.log('Conectando a la base de datos: ' + dbPath);

db.serialize(() => {
    // Intentar agregar la columna. Si ya existe, sqlite arrojará un error, lo cual es normal si el script se corre dos veces.
    db.run("ALTER TABLE users ADD COLUMN email TEXT;", (err) => {
        if (err) {
            if (err.message.includes('duplicate column name')) {
                console.log('✅ La columna "email" ya existe en la tabla users. No se requiere hacer nada.');
            } else {
                console.error('❌ Error alterando la tabla:', err.message);
            }
        } else {
            console.log('✅ Columna "email" agregada exitosamente a la tabla users.');
        }
    });
});

db.close((err) => {
    if (err) console.error(err.message);
    else console.log('Desconexión de la base de datos exitosa.');
});
