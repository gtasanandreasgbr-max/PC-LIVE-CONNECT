const { app, BrowserWindow, ipcMain, desktopCapturer, dialog, Notification, session } = require('electron');
const path = require('path');
const db = require('./database');
const logger = require('./logger');
const obsBridge = require('./obsBridge');

let mainWindow = null;

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('webrtc-max-cpu-consumption-percentage', '100');

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#0b111e',
    title: 'PC Live Connect',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'display-capture') {
      callback(true);
    } else {
      callback(false);
    }
  });

  logger.info('MAIN', 'Janela principal do PC Live Connect carregada.');
}

app.whenReady().then(() => {
  createMainWindow();

  ipcMain.handle('capture:get-sources', async () => {
    const auth = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Autorizar Captura', 'Cancelar'],
      defaultId: 0,
      cancelId: 1,
      title: 'Autorização de Captura - PC Live Connect',
      message: 'O PC Live Connect solicita acesso às telas e janelas deste computador para transmissão.',
      detail: 'Nenhuma imagem ou áudio será transmitido até que você inicie a sessão.',
    });

    if (auth.response !== 0) {
      logger.warn('SECURITY', 'Usuário negou permissão de listagem de fontes de captura.');
      return { authorized: false, sources: [] };
    }

    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });

    return {
      authorized: true,
      sources: sources.map((src) => ({
        id: src.id,
        name: src.name,
        type: src.id.startsWith('screen:') ? 'screen' : 'window',
        thumbnail: src.thumbnail.toDataURL(),
      })),
    };
  });

  ipcMain.handle('db:get-settings', () => db.getAllSettings());
  ipcMain.handle('db:save-setting', (_, key, value) => db.saveSetting(key, value));
  ipcMain.handle('db:log-session', (_, data) => {
    db.logSession(data.role, data.roomCode, data.durationSec, data.avgBitrateKbps);
    return db.getHistory();
  });
  ipcMain.handle('db:get-history', () => db.getHistory());

  ipcMain.on('notify:show', (_, { title, body }) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  });

  ipcMain.handle('obs:toggle-clean-window', (_, open) => {
    return open ? obsBridge.openCleanOutputWindow(mainWindow) : obsBridge.closeCleanOutputWindow();
  });

  ipcMain.handle('obs:start-virtual-cam', (_, deviceName, fps) => {
    return obsBridge.startVirtualCameraPipe(deviceName, fps);
  });

  ipcMain.on('obs:push-frame', (_, arrayBuffer) => {
    obsBridge.pushFrameToVirtualCam(Buffer.from(arrayBuffer));
  });

  ipcMain.handle('obs:stop-virtual-cam', () => {
    return obsBridge.stopVirtualCameraPipe();
  });

  ipcMain.on('log:write', (_, { level, module, message }) => {
    logger.write(level, module, message);
  });
});

app.on('window-all-closed', () => {
  obsBridge.stopVirtualCameraPipe();
  if (process.platform !== 'darwin') app.quit();
});
