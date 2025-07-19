// client.ts
import http from "http";
import net from "net";
import { v4 as uuid } from "uuid";
import { io, Socket } from "socket.io-client";
import Peer from "simple-peer";
// @ts-ignore
import wrtc from "wrtc";

// ========== CONFIGURAÇÃO ==========
const SIGNALING_URL = "http://SEU_SERVIDOR:3000";
const TUNNEL_ID = process.argv[2] || "tunnel-test";
const LOCAL_PROXY_PORT = 8081;
// ==================================

// Mapa para rastrear túneis TCP abertos (id => socket)
const tcpTunnels = new Map<string, net.Socket>();

console.log(
  `[Client] Iniciando client para túnel "${TUNNEL_ID}" em ${SIGNALING_URL}`
);
const socket: Socket = io(SIGNALING_URL);

// 1) Conecta ao servidor de sinalização e registra como client
socket.on("connect", () => {
  console.log(`[Client] Socket.IO conectado: ${socket.id}`);
  socket.emit("register", { role: "client", id: TUNNEL_ID });
});

// 2) Só depois do evento `ready` levantamos o WebRTC Peer
socket.on("ready", () => {
  console.log("[Client] Pronto (ready) recebido, criando Peer (non-initiator)");
  const peer = new Peer({
    initiator: false,
    wrtc,
    config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },
  });

  // 3) Troca de sinais SDP/ICE
  peer.on("signal", (data) => {
    console.log("[Client] Enviando signal para servidor");
    socket.emit("signal", { role: "client", id: TUNNEL_ID, data });
  });
  socket.on("signal", (data: any) => {
    console.log("[Client] Recebido signal do host");
    peer.signal(data);
  });

  // 4) Quando o canal de dados abrir, sobe o proxy local
  peer.on("connect", () => {
    console.log("[Client] Canal WebRTC conectado 👍");
    startLocalProxy(peer);
  });

  peer.on("error", (err) => {
    console.error("[Client] Erro no Peer:", err);
  });
});

function startLocalProxy(peer: Peer.Instance) {
  // Cria servidor HTTP para GET/POST
  const server = http.createServer((req, res) => {
    console.log(`[Client][HTTP] ${req.method} ${req.url}`);
    // Encapsula a requisição e envia ao host
    peer.send(
      JSON.stringify({
        type: "http",
        url: req.url,
        method: req.method,
        headers: req.headers,
      })
    );
    // Aguarda a resposta única
    const onData = (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "httpResponse") {
          console.log(`[Client][HTTP] ← ${msg.statusCode}`);
          res.writeHead(msg.statusCode, msg.headers);
          res.end(Buffer.from(msg.body, "base64"));
          peer.removeListener("data", onData);
        }
      } catch {
        // ignora dados binários
      }
    };
    peer.on("data", onData);
  });

  // Suporte a CONNECT (HTTPS)
  server.on("connect", (req, clientSocket, head) => {
    const id = uuid();
    const [host, portStr] = (req.url || "").split(":");
    const port = parseInt(portStr!, 10);
    console.log(`[Client][CONNECT] ${host}:${port} (túnel ${id})`);

    // 1) Peça ao host para abrir o TCP
    peer.send(JSON.stringify({ type: "tcp", id, host, port }));

    // 2) Aguarda o ack do host para começar a encadear bytes
    const onSignal = (raw: Buffer) => {
      // Pode vir JSON (ack) ou binário (dados TCP)
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "tcp-ack" && msg.id === id) {
          console.log(`[Client][CONNECT] túnel ${id} estabelecido`);
          // responde ao cliente que o túnel está pronto
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          // agora, qualquer dado TCP do host (binário) deve ser escrito no clientSocket
          peer.on("data", onTunnelData);
          peer.removeListener("data", onSignal);
        }
      } catch {
        // não-JSON: ignorar aqui
      }
    };

    // 3) Encaminha dados do browser ao host
    const onBrowserData = (chunk: Buffer) => {
      peer.send(chunk);
    };

    // 4) Ao receber dados brutos do host, envia ao browser
    const onTunnelData = (chunk: Buffer) => {
      if (Buffer.isBuffer(chunk)) {
        console.log(
          `[Client][CONNECT] túnel ${id} recebeu ${chunk.length} bytes`
        );
        clientSocket.write(chunk);
      }
    };

    // Registra listeners
    peer.on("data", onSignal);
    clientSocket.on("data", onBrowserData);

    // Cleanup ao fechar
    clientSocket.on("end", () => {
      console.log(`[Client][CONNECT] browser fechou túnel ${id}`);
      peer.removeListener("data", onTunnelData);
      peer.send(JSON.stringify({ type: "tcp-end", id }));
    });
  });

  // 5) Usa de fato o LOCAL_PROXY_PORT
  server.listen(LOCAL_PROXY_PORT, () =>
    console.log(
      `[Client] Proxy HTTP/HTTPS rodando em http://localhost:${LOCAL_PROXY_PORT}`
    )
  );
}
