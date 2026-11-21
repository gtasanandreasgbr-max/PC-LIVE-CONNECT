class SignalingClient {
  constructor() {
    this.ws = null;
    this.url = 'ws://localhost:8443';
    this.handlers = new Map();
    this.reconnectTimer = null;
    this.shouldReconnect = true;
    this.sessionState = null;
  }

  on(event, callback) {
    this.handlers.set(event, callback);
  }

  emit(event, data) {
    const cb = this.handlers.get(event);
    if (cb) cb(data);
  }

  connect(url) {
    if (url) this.url = url;
    this.shouldReconnect = true;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        window.pcLiveAPI.log('INFO', 'SIGNALING', `Conectado ao servidor: ${this.url}`);
        this.emit('status', { connected: true, url: this.url });

        if (this.sessionState) {
          if (this.sessionState.role === 'host') {
            this.send({
              type: 'reclaim-room',
              code: this.sessionState.code,
              sessionToken: this.sessionState.sessionToken,
            });
          } else if (this.sessionState.role === 'receiver') {
            this.send({ type: 'join-room', code: this.sessionState.code });
          }
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.emit(msg.type, msg);
        } catch (err) {
          window.pcLiveAPI.log('ERROR', 'SIGNALING', 'Erro ao processar mensagem WSS');
        }
      };

      this.ws.onclose = () => {
        this.emit('status', { connected: false, url: this.url });
        if (this.shouldReconnect) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(() => this.connect(), 3000);
        }
      };

      this.ws.onerror = () => {
        this.ws.close();
      };
    } catch (err) {
      window.pcLiveAPI.log('ERROR', 'SIGNALING', err.message);
    }
  }

  send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
}

window.signalingClient = new SignalingClient();
