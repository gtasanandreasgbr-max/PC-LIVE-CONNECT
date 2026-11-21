# Manual Operacional — PC Live Connect

## 1. Instalação do Servidor e Coturn (VPS Ubuntu/Debian)
1. Instale Node.js 20+ e Coturn:
   `sudo apt update && sudo apt install -y coturn certbot`
2. Libere no firewall: `8443/TCP`, `3478/TCP+UDP`, `5349/TCP`, `49152:65535/UDP`.
3. Copie `server/turnserver.conf` para `/etc/turnserver.conf` e reinicie o serviço:
   `sudo systemctl restart coturn`
4. Na pasta `server/`, copie `.env.example` para `.env`, configure suas chaves e rode:
   `npm install && npm start`

## 2. Compilação do Instalador Windows (.exe)
1. Adicione um ícone 256x256 em `client/build/icon.ico`.
2. Na pasta `client/`, execute:
   ```bash
   npm install
   npx electron-rebuild -f -w better-sqlite3
   npm run build:win
   ```
3. O instalador será gerado em `client/dist/PC-Live-Connect-Setup-1.0.0-x64.exe`.

## 3. Integração com OBS Studio (PC 2)
- **Áudio Isolado:** Instale o VB-CABLE, selecione `CABLE Input` nas configurações do PC Live Connect e adicione `CABLE Output` como Captura de Entrada de Áudio no OBS.
- **Vídeo:** Use o botão **Ativar Câmera Virtual OBS** (com driver DirectShow *Unity Video Capture*) ou **Janela Limpa OBS (720p)** para captura sem bordas.
