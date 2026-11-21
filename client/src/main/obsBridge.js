const { BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const logger = require('./logger');

class OBSBridge {
  constructor() {
    this.cleanWindow = null;
    this.ffmpegProcess = null;
    this.isStreamingToVirtualCam = false;
  }

  openCleanOutputWindow(parentWindow) {
    if (this.cleanWindow && !this.cleanWindow.isDestroyed()) {
      this.cleanWindow.focus();
      return { active: true };
    }

    this.cleanWindow = new BrowserWindow({
      width: 1280,
      height: 720,
      useContentSize: true,
      resizable: false,
      frame: false,
      backgroundColor: '#000000',
      title: 'PC Live Connect - OBS Clean Feed',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>PC Live Connect - OBS Clean Feed</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { background: #000; overflow: hidden; width: 1280px; height: 720px; }
          video { width: 1280px; height: 720px; object-fit: contain; background: #000; }
        </style>
      </head>
      <body>
        <video id="obsVideo" autoplay playsinline muted></video>
      </body>
      </html>
    `;

    this.cleanWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
    this.cleanWindow.on('closed', () => {
      this.cleanWindow = null;
      if (parentWindow && !parentWindow.isDestroyed()) {
        parentWindow.webContents.send('obs-clean-window-closed');
      }
    });

    logger.info('OBS_BRIDGE', 'Janela de saída limpa OBS (1280x720) aberta.');
    return { active: true };
  }

  closeCleanOutputWindow() {
    if (this.cleanWindow && !this.cleanWindow.isDestroyed()) {
      this.cleanWindow.close();
      this.cleanWindow = null;
    }
    return { active: false };
  }

  startVirtualCameraPipe(deviceName = 'Unity Video Capture', fps = 60) {
    if (this.ffmpegProcess) this.stopVirtualCameraPipe();

    const args = [
      '-y',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-r', String(fps),
      '-i', '-',
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=1280:720',
      '-f', 'dshow',
      `video=${deviceName}`
    ];

    try {
      this.ffmpegProcess = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] });
      this.isStreamingToVirtualCam = true;

      this.ffmpegProcess.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('Error') || msg.includes('Could not find')) {
          logger.warn('OBS_VIRTUAL_CAM', msg.trim());
        }
      });

      this.ffmpegProcess.on('close', (code) => {
        this.isStreamingToVirtualCam = false;
        this.ffmpegProcess = null;
        logger.info('OBS_VIRTUAL_CAM', `Pipeline encerrado (código ${code})`);
      });

      logger.info('OBS_BRIDGE', `Câmera Virtual iniciada no dispositivo: ${deviceName}`);
      return { success: true };
    } catch (err) {
      logger.error('OBS_BRIDGE', 'Falha ao iniciar FFmpeg Virtual Cam', err.message);
      return { success: false, error: err.message };
    }
  }

  pushFrameToVirtualCam(jpegBuffer) {
    if (this.isStreamingToVirtualCam && this.ffmpegProcess && this.ffmpegProcess.stdin.writable) {
      this.ffmpegProcess.stdin.write(jpegBuffer);
    }
  }

  stopVirtualCameraPipe() {
    if (this.ffmpegProcess) {
      try {
        this.ffmpegProcess.stdin.end();
        this.ffmpegProcess.kill('SIGTERM');
      } catch {}
      this.ffmpegProcess = null;
      this.isStreamingToVirtualCam = false;
    }
    return { success: true };
  }
}

module.exports = new OBSBridge();
