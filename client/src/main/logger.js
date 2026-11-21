const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Logger {
  constructor() {
    const logDir = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const dateStr = new Date().toISOString().split('T')[0];
    this.logFile = path.join(logDir, `pclive-${dateStr}.log`);
  }

  write(level, moduleName, message, meta = '') {
    const timestamp = new Date().toISOString();
    const formattedMeta = meta ? ` | ${typeof meta === 'object' ? JSON.stringify(meta) : meta}` : '';
    const line = `[${timestamp}] [${level}] [${moduleName}] ${message}${formattedMeta}\n`;
    fs.appendFile(this.logFile, line, () => {});
    if (level === 'ERROR') console.error(line.trim());
    else console.log(line.trim());
  }

  info(mod, msg, meta) { this.write('INFO', mod, msg, meta); }
  warn(mod, msg, meta) { this.write('WARN', mod, msg, meta); }
  error(mod, msg, meta) { this.write('ERROR', mod, msg, meta); }
}

module.exports = new Logger();
