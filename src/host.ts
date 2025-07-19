// host.ts
import { io, Socket } from "socket.io-client";
import Peer from "simple-peer";
// @ts-ignore
import wrtc from "wrtc";
import http from "http";
import net from "net";

// CONFIGURAÇÃO
const SIGNALING_URL = "http://15.228.71.40:3000";
const TUNNEL_ID = process.argv[2] || "tunnel-test";
const LOCAL_PROXY_PORT = 8080;

console.log(`[Host] Conectando em ${SIGNALING_URL} com ID="${TUNNEL_ID}"`);
const socket: Socket = io(SIGNALING_URL);

socket.on("connect", () => {
  console.log("[Host] Socket.IO conectado:", socket.id);
  socket.emit("register", { role: "host", id: TUNNEL_ID });
  console.log("[Host] Registro enviado (host)");
});

socket.on("ready", () => {
  console.log("[Host] Evento ready recebido → iniciando WebRTC Peer");
  const peer = new Peer({
    initiator: true,
    wrtc,
    config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },
  });

  peer.on("signal", (data) => {
    console.log("[Host] Enviando signal SDP/ICE ao servidor");
    socket.emit("signal", { role: "host", id: TUNNEL_ID, data });
  });

  socket.on("signal", (data: any) => {
    console.log("[Host] Sinal recebido do client");
    peer.signal(data);
  });

  peer.on("connect", () => {
    console.log("[Host] Canal de dados WebRTC ESTABELECIDO");
  });

  peer.on("error", (err) => {
    console.error("[Host] Erro no Peer:", err);
  });

  // HTTP Proxy local opcional
  http
    .createServer((req, res) => {
      const url = req.url?.startsWith("http")
        ? req.url
        : `http://${req.headers.host}${req.url}`;
      console.log(`[Host][HTTP] Requisição: ${req.method} ${url}`);
      peer.send(
        JSON.stringify({
          type: "http",
          url,
          method: req.method,
          headers: req.headers,
        })
      );
      peer.once("data", (raw) => {
        const msg = JSON.parse(raw.toString());
        res.writeHead(msg.statusCode, msg.headers);
        res.end(Buffer.from(msg.body, "base64"));
        console.log(`[Host][HTTP] Resposta ${msg.statusCode} enviada`);
      });
    })
    .listen(LOCAL_PROXY_PORT, () => {
      console.log(
        `[Host] Proxy HTTP local em http://localhost:${LOCAL_PROXY_PORT}`
      );
    });

  // Mecanismo de túnel TCP para CONNECT (HTTPS)
  peer.on("data", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "tcp") {
        console.log(
          `[Host][TCP] Abrindo túnel TCP → ${msg.host}:${msg.port} (id=${msg.id})`
        );
        const sock = net.connect(msg.port, msg.host, () => {
          console.log("[Host][TCP] Conexão TCP estabelecida, enviando ACK");
          peer.send(JSON.stringify({ type: "tcp-ack", id: msg.id }));
        });
        // encaminha dados do peer ao socket
        peer.on("data", (chunk) => {
          if (!Buffer.isBuffer(chunk)) return;
          sock.write(chunk);
        });
        // encaminha do socket ao peer
        sock.on("data", (data) => peer.send(data));
        sock.on("error", (err) => {
          console.error("[Host][TCP] Erro no socket:", err.message);
          peer.send(
            JSON.stringify({
              type: "tcp-error",
              id: msg.id,
              error: err.message,
            })
          );
        });
      }
    } catch {
      /** não-JSON: ignora */
    }
  });
});
