// client.ts
import { io, Socket } from "socket.io-client";
import Peer from "simple-peer";
// @ts-ignore
import wrtc from "wrtc";
import http from "http";
import net from "net";
import { v4 as uuid } from "uuid";

// Ajuste aqui:
const SIGNALING_URL = "http://SEU_SERVIDOR:3000";
const TUNNEL_ID = process.argv[2] || "meu-tunel";
const LOCAL_PROXY_PORT = 8081;

console.log(
  `[Client] Iniciando Client com ID="${TUNNEL_ID}", sinalizando em ${SIGNALING_URL}`
);

const socket: Socket = io(SIGNALING_URL);
socket.on("connect", () => {
  console.log("[Client] Conectado ao servidor de sinalização:", socket.id);
  socket.emit("register", { role: "client", id: TUNNEL_ID });
});

const peer = new Peer({
  initiator: false,
  wrtc,
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      // { urls: 'turn:seu.turn.server', username: 'user', credential: 'pass' }
    ],
  },
});

peer.on("signal", (data) => {
  console.log("[Client] Enviando sinal SDP/ICE ao servidor");
  socket.emit("signal", { role: "client", id: TUNNEL_ID, data });
});

socket.on("signal", (data: any) => {
  console.log("[Client] Recebido sinal do host via servidor");
  peer.signal(data);
});

peer.on("connect", () => {
  console.log("[Client] Canal de dados WebRTC estabelecido");
  startLocalProxy();
});

peer.on("error", (err) => {
  console.error("[Client] Erro no Peer:", err);
});

function startLocalProxy() {
  const server = http.createServer((req, res) => {
    // HTTP normal
    console.log(`[Client] Proxy HTTP ➡️ ${req.method} ${req.url}`);
    const msg = {
      type: "http",
      url: req.url,
      method: req.method,
      headers: req.headers,
    };
    peer.send(JSON.stringify(msg));
    peer.once("data", (raw) => {
      const rep = JSON.parse(raw.toString());
      console.log(`[Client] Response HTTP ← ${rep.statusCode}`);
      res.writeHead(rep.statusCode, rep.headers);
      res.end(Buffer.from(rep.body, "base64"));
    });
  });

  // Suporte a CONNECT para HTTPS
  server.on("connect", (req, clientSocket, head) => {
    const id = uuid();
    const [host, portStr] = (req.url || "").split(":");
    const port = parseInt(portStr!, 10);
    console.log(`[Client] Proxy CONNECT ➡️ ${host}:${port} (id=${id})`);

    // 1) Instrui o host a abrir TCP
    peer.send(JSON.stringify({ type: "tcp", host, port, id }));

    // 2) Aguarda ACK do host
    const onAck = (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "tcp-ack" && msg.id === id) {
          console.log(
            `[Client] RECEBIDO tcp-ack (id=${id}), estabelecendo túnel`
          );
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

          // 3) Conecta localmente a um socket de túnel (ponte)
          const remote = net.connect({
            host: "localhost",
            port: LOCAL_PROXY_PORT,
          });
          // encaminha dados iniciais, se houver
          if (head && head.length) remote.write(head);
          clientSocket.pipe(remote).pipe(clientSocket);

          // remove listener de ACK
          peer.removeListener("data", onAck);
        }
      } catch (_) {
        /** ignorar */
      }
    };
    peer.on("data", onAck);

    // 4) Timeout caso não haja resposta
    setTimeout(() => {
      peer.removeListener("data", onAck);
      clientSocket.end("HTTP/1.1 504 Gateway Timeout\r\n\r\n");
      console.error(`[Client] Timeout aguardando tcp-ack (id=${id})`);
    }, 10000);
  });

  server.listen(LOCAL_PROXY_PORT, () => {
    console.log(
      `[Client] Proxy HTTP/HTTPS em http://localhost:${LOCAL_PROXY_PORT}`
    );
  });
}
