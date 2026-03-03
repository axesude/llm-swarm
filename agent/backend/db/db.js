// /backend/db/db.js

/**
 * @fileoverview SQLite database singleton and promisified query helpers.
 * 
 * WHY:
 * 1. Singleton: Prevents multiple concurrent connections to the same file, 
 *    which can lead to locking issues in SQLite.
 * 2. Promisified: Converts the standard callback-based sqlite3 API into 
 *    modern async/await patterns for cleaner code.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || path.resolve(__dirname, 'swarm.db');

let dbInstance;

/**
 * Ensures a single connection to the SQLite database exists.
 * 
 * @returns {Promise<sqlite3.Database>} The shared database instance.
 */
async function getDb() {
    if (!dbInstance) {
        dbInstance = new sqlite3.Database(SQLITE_DB_PATH, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
            if (err) {
                console.error(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: 'ERROR',
                    message: 'SQLite connection failed',
                    error: err.message
                }));
                throw err;
            }
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'INFO',
                message: `Connected to SQLite: ${SQLITE_DB_PATH}`
            }));
        });
    }
    return dbInstance;
}

/**
 * Executes a query that doesn't return rows (INSERT, UPDATE, DELETE).
 * 
 * @param {string} sql - The query string.
 * @param {Array<any>} [params] - Optional query parameters.
 * @returns {Promise<{lastID: number, changes: number}>} Metadata about the execution.
 */
function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        getDb().then(db => {
            db.run(sql, params, function (err) {
                if (err) return reject(err);
                resolve({ lastID: this.lastID, changes: this.changes });
            });
        }).catch(reject);
    });
}

/**
 * Executes a query and returns all matching rows.
 * 
 * @param {string} sql - The query string.
 * @param {Array<any>} [params] - Optional parameters.
 * @returns {Promise<Array<any>>} Array of row objects.
 */
function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        getDb().then(db => {
            db.all(sql, params, (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        }).catch(reject);
    });
}

/**
 * Executes a query and returns only the first matching row.
 * 
 * @param {string} sql - The query string.
 * @param {Array<any>} [params] - Optional parameters.
 * @returns {Promise<any|undefined>} The row object or undefined if no match.
 */
function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        getDb().then(db => {
            db.get(sql, params, (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        }).catch(reject);
    });
}

/**
 * Properly shuts down the database connection.
 * 
 * @returns {Promise<void>}
 */
function closeDb() {
    return new Promise((resolve, reject) => {
        if (dbInstance) {
            dbInstance.close((err) => {
                if (err) return reject(err);
                dbInstance = null;
                resolve();
            });
        } else {
            resolve();
        }
    });
}

module.exports = {
    getDb,
    run,
    all,
    get,
    closeDb,
};
