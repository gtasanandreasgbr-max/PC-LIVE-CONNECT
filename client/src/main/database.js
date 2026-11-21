const path = require('path');
const { app } = require('electron');
const Database = require('better-sqlite3');
const logger = require('./logger');

class LocalDatabase {
  constructor() {
    const dbPath = path.join(app.getPath('userData'), 'pcliveconnect.db');
    this.db = new Database(dbPath);
    this.init();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        room_code TEXT NOT NULL,
        duration_sec INTEGER DEFAULT 0,
        avg_bitrate_kbps INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const defaults = {
      signalingUrl: 'ws://localhost:8443',
      resolution: '1280x720',
      fps: '60',
      codec: 'H264',
      bitrateKbps: '4500',
      autoAdjustQuality: 'true',
      autoReconnect: 'true',
      obsAudioDevice: 'default'
    };

    const insert = this.db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(defaults)) {
      insert.run(k, v);
    }
    logger.info('DATABASE', 'Banco de dados SQLite inicializado com sucesso.');
  }

  getAllSettings() {
    const rows = this.db.prepare('SELECT key, value FROM settings').all();
    return rows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
  }

  saveSetting(key, value) {
    this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
    return this.getAllSettings();
  }

  logSession(role, roomCode, durationSec, avgBitrateKbps) {
    this.db.prepare(
      'INSERT INTO session_history (role, room_code, duration_sec, avg_bitrate_kbps) VALUES (?, ?, ?, ?)'
    ).run(role, roomCode, durationSec, avgBitrateKbps);
  }

  getHistory(limit = 10) {
    return this.db.prepare('SELECT * FROM session_history ORDER BY id DESC LIMIT ?').all(limit);
  }
}

module.exports = new LocalDatabase();
