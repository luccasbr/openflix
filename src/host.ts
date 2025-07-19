import { io, Socket } from "socket.io-client";
import Peer from "simple-peer";
// @ts-ignore
import wrtc from "wrtc";
import fetch from "node-fetch";

// Configurações
const SIGNALING_URL = "http://SEU_SERVIDOR:3000";
const TUNNEL_ID = process.argv[2] || "meu-tunel";

console.log(`[Host] Conectando em ${SIGNALING_URL} com ID="${TUNNEL_ID}"`);
const socket: Socket = io(SIGNALING_URL);

socket.on("connect", () => {
  console.log("[Host] Socket.IO conectado:", socket.id);
  socket.emit("register", { role: "host", id: TUNNEL_ID });
});

socket.on("ready", () => {
  console.log("[Host] Evento ready recebido → iniciando Peer");
  const peer = new Peer({
    initiator: true,
    wrtc,
    config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },
  });

  peer.on("signal", (data) => {
    console.log("[Host] Enviando signal ao servidor");
    socket.emit("signal", { role: "host", id: TUNNEL_ID, data });
  });

  socket.on("signal", (data: any) => {
    console.log("[Host] Recebido signal do client");
    peer.signal(data);
  });

  peer.on("connect", () => {
    console.log("[Host] WebRTC conectado, canal de dados aberto");
  });

  peer.on("data", async (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "http") {
      console.log(`[Host] Proxy HTTP ➡️ ${msg.method} ${msg.url}`);
      const res = await fetch(msg.url, {
        method: msg.method,
        headers: msg.headers,
      });
      const body = await res.arrayBuffer();
      peer.send(
        JSON.stringify({
          type: "httpResponse",
          statusCode: res.status,
          headers: Object.fromEntries(res.headers.entries()),
          body: Buffer.from(body).toString("base64"),
        })
      );
      console.log(
        `[Host] Response ${res.status} enviada (${(
          body.byteLength / 1024
        ).toFixed(1)} KB)`
      );
    }
    // … código para tcp tunnel permanece igual …
  });
});
