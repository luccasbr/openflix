import { io, Socket } from "socket.io-client";
import Peer from "simple-peer";
// @ts-ignore
import wrtc from "wrtc";
import fetch from "node-fetch";
import http from "http";

const SIGNALING = "http://15.228.71.40:3000";
const TUNNEL_ID = process.argv[2] || "meu-tunel";

console.log("[Host] Iniciando host com ID:", TUNNEL_ID);
const socket: Socket = io(SIGNALING);

socket.on(
  "connect",
  () => console.log("[Host] Conectado ao servidor de sinalização", socket.id) // :contentReference[oaicite:9]{index=9}
);

socket.emit("register", { role: "host", id: TUNNEL_ID });
console.log("[Host] Registro enviado ao servidor"); // :contentReference[oaicite:10]{index=10}

const peer = new Peer({ initiator: true, wrtc });

peer.on("signal", (data) => {
  console.log("[Host] Gerado sinal:", data); // :contentReference[oaicite:11]{index=11}
  socket.emit("signal", { role: "host", id: TUNNEL_ID, data });
});

socket.on("signal", (data) => {
  console.log("[Host] Sinal recebido do servidor:", data);
  peer.signal(data);
});

peer.on(
  "connect",
  () => console.log("[Host] DataChannel aberto") // :contentReference[oaicite:12]{index=12}
);

peer.on("data", async (raw) => {
  console.log("[Host] Requisição recebida via DataChannel");
  try {
    const msg = JSON.parse(raw.toString());
    console.log("[Host] Fetch para", msg.url);
    const res = await fetch(msg.url, {
      method: msg.method,
      headers: msg.headers,
    });
    const buffer = await res.arrayBuffer();
    peer.send(
      JSON.stringify({
        type: "httpResponse",
        statusCode: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body: Buffer.from(buffer).toString("base64"),
      })
    );
    console.log("[Host] Resposta enviada ao client"); // :contentReference[oaicite:13]{index=13}
  } catch (err) {
    console.error("[Host] Erro no fetch:", err);
  }
});

peer.on(
  "error",
  (err) => console.error("[Host] Peer error:", err) // :contentReference[oaicite:14]{index=14}
);

// Proxy HTTP local
const server = http.createServer((req, res) => {
  console.log("[Host] Proxy HTTP — requisição:", req.method, req.url);
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
    console.log("[Host] Proxy HTTP — resposta", msg.statusCode);
    res.writeHead(msg.statusCode, msg.headers);
    res.write(Buffer.from(msg.body, "base64"));
    res.end();
  });
});

server.listen(8080, () => {
  console.log("[Host] Proxy HTTP rodando em http://localhost:8080"); // :contentReference[oaicite:15]{index=15}
});
