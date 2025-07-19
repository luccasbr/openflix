// client.ts
import http from "http";
import { io, Socket } from "socket.io-client";
import Peer from "simple-peer";
// @ts-ignore
import wrtc from "wrtc";
import { v4 as uuid } from "uuid";

// CONFIGURAÇÃO
const SIGNALING_URL = "http://15.228.71.40:3000";
const TUNNEL_ID = process.argv[2] || "tunnel-test";
const LOCAL_PROXY_PORT = 8081;

console.log(`[Client] Conectando em ${SIGNALING_URL} com ID="${TUNNEL_ID}"`);
const socket: Socket = io(SIGNALING_URL);

socket.on("connect", () => {
  console.log("[Client] Socket.IO conectado:", socket.id);
  socket.emit("register", { role: "client", id: TUNNEL_ID });
  console.log("[Client] Registro enviado (client)");
});

socket.on("ready", () => {
  console.log("[Client] Evento ready recebido → iniciando WebRTC Peer");
  const peer = new Peer({
    initiator: false,
    wrtc,
    config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },
  });

  peer.on("signal", (data) => {
    console.log("[Client] Enviando signal SDP/ICE ao servidor");
    socket.emit("signal", { role: "client", id: TUNNEL_ID, data });
  });
  socket.on("signal", (data: any) => {
    console.log("[Client] Sinal recebido do host");
    peer.signal(data);
  });

  peer.on("connect", () => {
    console.log("[Client] Canal de dados WebRTC ESTABELECIDO");
    startLocalProxy(peer);
  });

  peer.on("error", (err) => {
    console.error("[Client] Erro no Peer:", err);
  });
});

function startLocalProxy(peer: Peer.Instance) {
  const server = http.createServer((req, res) => {
    console.log(`[Client][HTTP] ${req.method} ${req.url}`);
    peer.send(
      JSON.stringify({
        type: "http",
        url: req.url,
        method: req.method,
        headers: req.headers,
      })
    );
    peer.once("data", (raw) => {
      const msg = JSON.parse(raw.toString());
      res.writeHead(msg.statusCode, msg.headers);
      res.end(Buffer.from(msg.body, "base64"));
      console.log(`[Client][HTTP] ← ${msg.statusCode}`);
    });
  });

  server.on("connect", (req, clientSocket, head) => {
    const id = uuid();
    const [host, portStr] = (req.url || "").split(":");
    const port = parseInt(portStr!, 10);
    console.log(`[Client][CONNECT] ${host}:${port} (túnel ${id})`);

    // 1) Informa ao host para abrir TCP
    peer.send(JSON.stringify({ type: "tcp", id, host, port }));

    // 2) Aguarda ACK para estabelecer túnel
    const onSignal = (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "tcp-ack" && msg.id === id) {
          console.log(`[Client][CONNECT] túnel ${id} estabelecido`);
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          // passa head se houver
          if (head && head.length) clientSocket.write(head);
          // agora túnel bidirecional direto no WebRTC
          peer.on("data", (chunk) => {
            if (Buffer.isBuffer(chunk)) clientSocket.write(chunk);
          });
          clientSocket.on("data", (chunk) => peer.send(chunk));
          peer.removeListener("data", onSignal);
        }
      } catch {
        /** ignora não-JSON */
      }
    };
    peer.on("data", onSignal);

    // timeout de 10s
    setTimeout(() => {
      peer.removeListener("data", onSignal);
      clientSocket.end("HTTP/1.1 504 Gateway Timeout\r\n\r\n");
      console.error(`[Client][CONNECT] Timeout no túnel ${id}`);
    }, 10000);
  });

  server.listen(LOCAL_PROXY_PORT, () => {
    console.log(
      `[Client] Proxy HTTP/HTTPS em http://localhost:${LOCAL_PROXY_PORT}`
    );
  });
}
