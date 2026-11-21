class MediaCaptureManager {
  constructor() {
    this.screenStream = null;
    this.micStream = null;
    this.combinedStream = null;
    this.audioContext = null;
    this.micGainNode = null;
  }

  async populateAudioDevices(micSelectEl, outputSelectEl) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    micSelectEl.innerHTML = '<option value="default">Microfone Padrão do Sistema</option>';
    outputSelectEl.innerHTML = '<option value="default">Saída de Áudio Padrão (Windows)</option>';

    devices.forEach((dev) => {
      if (dev.kind === 'audioinput' && dev.deviceId !== 'default') {
        const opt = document.createElement('option');
        opt.value = dev.deviceId;
        opt.textContent = dev.label || `Microfone (${dev.deviceId.slice(0, 6)})`;
        micSelectEl.appendChild(opt);
      }
      if (dev.kind === 'audiooutput' && dev.deviceId !== 'default') {
        const opt = document.createElement('option');
        opt.value = dev.deviceId;
        opt.textContent = dev.label || `Saída (${dev.deviceId.slice(0, 6)})`;
        outputSelectEl.appendChild(opt);
      }
    });
  }

  async startCapture({ sourceId, fps = 60, captureSystemAudio = true, captureMic = false, micDeviceId = 'default' }) {
    this.stopCapture();

    const constraints = {
      audio: captureSystemAudio
        ? {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
            },
          }
        : false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          minWidth: 1280,
          maxWidth: 1280,
          minHeight: 720,
          maxHeight: 720,
          minFrameRate: Number(fps),
          maxFrameRate: Number(fps),
        },
      },
    };

    this.screenStream = await navigator.mediaDevices.getUserMedia(constraints);

    this.audioContext = new AudioContext({ sampleRate: 48000 });
    const destination = this.audioContext.createMediaStreamDestination();
    destination.channelCount = 2;

    if (captureSystemAudio && this.screenStream.getAudioTracks().length > 0) {
      const sysSource = this.audioContext.createMediaStreamSource(
        new MediaStream([this.screenStream.getAudioTracks()[0]])
      );
      sysSource.connect(destination);
    }

    if (captureMic) {
      await this.enableMicrophone(micDeviceId, destination);
    }

    this.combinedStream = new MediaStream();
    this.screenStream.getVideoTracks().forEach((track) => {
      track.contentHint = 'motion';
      this.combinedStream.addTrack(track);
    });

    if (captureSystemAudio || captureMic) {
      destination.stream.getAudioTracks().forEach((track) => {
        this.combinedStream.addTrack(track);
      });
    }

    return this.combinedStream;
  }

  async enableMicrophone(deviceId = 'default', existingDest = null) {
    if (!this.audioContext) return;
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId !== 'default' ? { exact: deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const micSource = this.audioContext.createMediaStreamSource(this.micStream);
    this.micGainNode = this.audioContext.createGain();
    this.micGainNode.gain.value = 1.0;
    micSource.connect(this.micGainNode);

    if (existingDest) {
      this.micGainNode.connect(existingDest);
    }
  }

  toggleMicMute(muted) {
    if (this.micGainNode) {
      this.micGainNode.gain.value = muted ? 0 : 1.0;
    }
  }

  stopCapture() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.combinedStream = null;
  }
}

window.mediaCapture = new MediaCaptureManager();
