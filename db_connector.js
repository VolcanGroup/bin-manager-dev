const dbModule = process.env.MARIADB_URI ? './database_mariadb' : (process.env.DATABASE_URL ? './database_pg' : './database');
module.exports = require(dbModule);
