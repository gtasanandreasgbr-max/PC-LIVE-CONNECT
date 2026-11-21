class TelemetryMonitor {
  constructor() {
    this.interval = null;
    this.prevStats = {
      bytesSent: 0,
      bytesReceived: 0,
      audioBytes: 0,
      timestamp: 0,
    };
    this.bitrateHistory = [];
  }

  start(pc, role, onAdaptiveAdjust) {
    this.stop();
    this.prevStats = { bytesSent: 0, bytesReceived: 0, audioBytes: 0, timestamp: performance.now() };
    this.bitrateHistory = [];

    this.interval = setInterval(async () => {
      if (!pc || pc.connectionState === 'closed') return;

      const stats = await pc.getStats();
      const now = performance.now();
      const dtSec = Math.max((now - this.prevStats.timestamp) / 1000, 0.5);

      let fpsSent = 0;
      let fpsRecv = 0;
      let videoKbps = 0;
      let audioKbps = 0;
      let rttMs = 0;
      let packetLossPct = 0;
      let routeType = 'Direto (P2P)';
      let resolution = '1280×720';

      stats.forEach((report) => {
        if (report.type === 'outbound-rtp' && report.kind === 'video') {
          fpsSent = Math.round(report.framesPerSecond || 0);
          if (this.prevStats.bytesSent > 0) {
            videoKbps = Math.round(((report.bytesSent - this.prevStats.bytesSent) * 8) / 1000 / dtSec);
          }
          this.prevStats.bytesSent = report.bytesSent;
          if (report.frameWidth && report.frameHeight) {
            resolution = `${report.frameWidth}×${report.frameHeight}`;
          }
        }

        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          fpsRecv = Math.round(report.framesPerSecond || 0);
          if (this.prevStats.bytesReceived > 0) {
            videoKbps = Math.round(((report.bytesReceived - this.prevStats.bytesReceived) * 8) / 1000 / dtSec);
          }
          this.prevStats.bytesReceived = report.bytesReceived;
          if (report.frameWidth && report.frameHeight) {
            resolution = `${report.frameWidth}×${report.frameHeight}`;
          }
          const totalPackets = (report.packetsReceived || 0) + (report.packetsLost || 0);
          if (totalPackets > 0) {
            packetLossPct = ((report.packetsLost || 0) / totalPackets) * 100;
          }
        }

        if ((report.type === 'outbound-rtp' || report.type === 'inbound-rtp') && report.kind === 'audio') {
          const bytes = report.bytesSent || report.bytesReceived || 0;
          if (this.prevStats.audioBytes > 0) {
            audioKbps = Math.round(((bytes - this.prevStats.audioBytes) * 8) / 1000 / dtSec);
          }
          this.prevStats.audioBytes = bytes;
        }

        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          rttMs = Math.round((report.currentRoundTripTime || 0) * 1000);
          const localCand = stats.get(report.localCandidateId);
          const remoteCand = stats.get(report.remoteCandidateId);
          if ((localCand && localCand.candidateType === 'relay') || (remoteCand && remoteCand.candidateType === 'relay')) {
            routeType = 'TURN Relay Ativo';
          }
        }
      });

      this.prevStats.timestamp = now;
      if (videoKbps > 0) this.bitrateHistory.push(videoKbps);

      document.getElementById('statConnState').textContent = pc.connectionState.toUpperCase();
      document.getElementById('statResolution').textContent = resolution;
      document.getElementById('statFps').textContent = `${fpsSent} / ${fpsRecv} FPS`;
      document.getElementById('statVideoBitrate').textContent = `${videoKbps} kbps`;
      document.getElementById('statAudioBitrate').textContent = `${audioKbps} kbps`;
      document.getElementById('statLatency').textContent = `${rttMs} ms`;
      document.getElementById('statPacketLoss').textContent = `${packetLossPct.toFixed(1)}%`;
      document.getElementById('statTurnState').textContent = routeType;

      if (role === 'host' && typeof onAdaptiveAdjust === 'function') {
        onAdaptiveAdjust({ packetLossPct, rttMs });
      }
    }, 1000);
  }

  getAverageBitrate() {
    if (this.bitrateHistory.length === 0) return 0;
    const sum = this.bitrateHistory.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.bitrateHistory.length);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}

window.telemetryMonitor = new TelemetryMonitor();
