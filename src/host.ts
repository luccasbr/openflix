// host.ts
import { io, Socket } from "socket.io-client";
import Peer from "simple-peer";
// @ts-ignore
import wrtc from "wrtc";
import fetch from "node-fetch";
import http from "http";
import net from "net";

// Ajuste aqui:
const SIGNALING_URL = "http://SEU_SERVIDOR:3000";
const TUNNEL_ID = process.argv[2] || "meu-tunel";
const LOCAL_PROXY_PORT = 8080;

console.log(
  `[Host] Iniciando Host com ID="${TUNNEL_ID}", sinalizando em ${SIGNALING_URL}`
);

const socket: Socket = io(SIGNALING_URL);
socket.on("connect", () => {
  console.log("[Host] Conectado ao servidor de sinalização:", socket.id);
  socket.emit("register", { role: "host", id: TUNNEL_ID });
});

const peer = new Peer({
  initiator: true,
  wrtc,
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      // { urls: 'turn:seu.turn.server', username: 'user', credential: 'pass' }
    ],
  },
});

peer.on("signal", (data) => {
  console.log("[Host] Enviando sinal SDP/ICE ao servidor");
  socket.emit("signal", { role: "host", id: TUNNEL_ID, data });
});

socket.on("signal", (data: any) => {
  console.log("[Host] Recebido sinal do client via servidor");
  peer.signal(data);
});

peer.on("connect", () => {
  console.log("[Host] Canal de dados WebRTC estabelecido");
});

peer.on("error", (err) => {
  console.error("[Host] Erro no Peer:", err);
});

peer.on("data", async (raw) => {
  try {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "http") {
      console.log(`[Host] HTTP request ➡️ ${msg.method} ${msg.url}`);
      const res = await fetch(msg.url, {
        method: msg.method,
        headers: msg.headers,
      });
      const buffer = await res.arrayBuffer();
      const payload = {
        type: "httpResponse",
        statusCode: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body: Buffer.from(buffer).toString("base64"),
      };
      console.log(
        `[Host] HTTP response ← ${res.status} (${(
          buffer.byteLength / 1024
        ).toFixed(1)} KB)`
      );
      peer.send(JSON.stringify(payload));
    } else if (msg.type === "tcp") {
      console.log(`[Host] Túnel TCP ➡️ ${msg.host}:${msg.port}`);
      const sock = net.connect(msg.port, msg.host, () => {
        console.log("[Host] Socket TCP conectado ao destino, enviando ACK");
        peer.send(JSON.stringify({ type: "tcp-ack", id: msg.id }));
        // agora cria o túnel entre sock <-> DataChannel
        sock.on("data", (data) => peer.send(data));
        sock.on("end", () =>
          console.log("[Host] Socket TCP encerrado pelo destino")
        );
      });
      sock.on("error", (err) => {
        console.error("[Host] Erro no socket TCP:", err.message);
        peer.send(
          JSON.stringify({ type: "tcp-error", id: msg.id, error: err.message })
        );
      });
      // recebe dados do client e encaminha ao sock
      peer.on("data", (chunk) => {
        if (typeof chunk !== "string") {
          sock.write(chunk);
        }
      });
    }
  } catch (e) {
    console.error("[Host] Mensagem inválida:", e);
  }
});

// Proxy HTTP local para teste (opcional)
http
  .createServer((req, res) => {
    // redireciona toda req normal ao túnel HTTP
    const url = req.url?.startsWith("http")
      ? req.url
      : `http://${req.headers.host}${req.url}`;
    const msg = {
      type: "http",
      url,
      method: req.method,
      headers: req.headers,
    };
    peer.send(JSON.stringify(msg));
    peer.once("data", (raw) => {
      const rep = JSON.parse(raw.toString());
      res.writeHead(rep.statusCode, rep.headers);
      res.end(Buffer.from(rep.body, "base64"));
    });
  })
  .listen(LOCAL_PROXY_PORT, () => {
    console.log(
      `[Host] Proxy HTTP local em http://localhost:${LOCAL_PROXY_PORT}`
    );
  });
