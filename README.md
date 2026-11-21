# PC Live Connect — Pro Broadcast Suite

Transmissão profissional de tela e áudio em tempo real entre dois computadores Windows conectados pela internet, com integração nativa para OBS Studio.

## Estrutura do Projeto
- `server/`: Servidor de Sinalização WSS (Node.js) e configuração Coturn (STUN/TURN).
- `client/`: Aplicativo Desktop Windows (Electron + WebRTC + SQLite + FFmpeg).
- `docs/`: Manual operacional, guia de instalação e resolução de problemas.
