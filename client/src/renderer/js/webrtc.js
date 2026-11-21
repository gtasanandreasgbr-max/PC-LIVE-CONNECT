class WebRTCManager {
  constructor() {
    this.pc = null;
    this.role = null;
    this.iceServers = [];
    this.targetBitrateKbps = 4500;
    this.currentBitrateKbps = 4500;
    this.autoAdjust = true;
    this.preferredCodec = 'H264';
  }

  initPeerConnection({ role, iceServers, localStream, onRemoteStream, onStateChange }) {
    this.close();
    this.role = role;
    this.iceServers = iceServers;

    this.pc = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });

    if (localStream && role === 'host') {
      localStream.getTracks().forEach((track) => {
        this.pc.addTrack(track, localStream);
      });
      this.applyCodecPreference(this.preferredCodec);
    }

    this.pc.ontrack = (event) => {
      if (event.streams && event.streams[0] && onRemoteStream) {
        onRemoteStream(event.streams[0]);
      }
    };

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        window.signalingClient.send({
          type: 'signal',
          data: { candidate: event.candidate },
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      window.pcLiveAPI.log('INFO', 'WEBRTC', `Estado da conexão (${role}): ${state}`);
      if (onStateChange) onStateChange(state);

      if (state === 'connected') {
        this.applyBitrateLimit(this.targetBitrateKbps);
        window.telemetryMonitor.start(this.pc, role, (netStats) => this.handleAdaptiveBitrate(netStats));
      } else if (state === 'failed') {
        if (role === 'host') this.createAndSendOffer(true);
      }
    };

    return this.pc;
  }

  applyCodecPreference(codecName) {
    const transceivers = this.pc.getTransceivers();
    transceivers.forEach((transceiver) => {
      if (transceiver.sender && transceiver.sender.track && transceiver.sender.track.kind === 'video') {
        const capabilities = RTCRtpSender.getCapabilities('video');
        if (!capabilities) return;
        const preferred = capabilities.codecs.filter((c) =>
          c.mimeType.toLowerCase().includes(codecName.toLowerCase())
        );
        const others = capabilities.codecs.filter(
          (c) => !c.mimeType.toLowerCase().includes(codecName.toLowerCase())
        );
        if (preferred.length > 0 && transceiver.setCodecPreferences) {
          transceiver.setCodecPreferences([...preferred, ...others]);
        }
      }
    });
  }

  async applyBitrateLimit(kbps) {
    if (!this.pc) return;
    const senders = this.pc.getSenders();
    for (const sender of senders) {
      if (sender.track && sender.track.kind === 'video') {
        const params = sender.getParameters();
        if (!params.encodings) params.encodings = [{}];
        params.encodings[0].maxBitrate = kbps * 1000;
        params.degradationPreference = 'maintain-framerate';
        await sender.setParameters(params).catch(() => {});
      }
    }
  }

  handleAdaptiveBitrate({ packetLossPct, rttMs }) {
    if (!this.autoAdjust) return;
    if (packetLossPct > 3.0 || rttMs > 180) {
      this.currentBitrateKbps = Math.max(1200, Math.round(this.currentBitrateKbps * 0.85));
      this.applyBitrateLimit(this.currentBitrateKbps);
    } else if (packetLossPct < 0.5 && rttMs < 80 && this.currentBitrateKbps < this.targetBitrateKbps) {
      this.currentBitrateKbps = Math.min(this.targetBitrateKbps, this.currentBitrateKbps + 250);
      this.applyBitrateLimit(this.currentBitrateKbps);
    }
  }

  async createAndSendOffer(iceRestart = false) {
    if (!this.pc) return;
    const offer = await this.pc.createOffer({ iceRestart });
    await this.pc.setLocalDescription(offer);
    window.signalingClient.send({
      type: 'signal',
      data: { sdp: this.pc.localDescription },
    });
  }

  async handleSignal(data) {
    if (!this.pc) return;
    if (data.sdp) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      if (data.sdp.type === 'offer') {
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        window.signalingClient.send({
          type: 'signal',
          data: { sdp: this.pc.localDescription },
        });
      }
    } else if (data.candidate) {
      await this.pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
    }
  }

  close() {
    window.telemetryMonitor.stop();
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
  }
}

window.webrtcManager = new WebRTCManager();
