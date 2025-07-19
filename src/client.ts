import { io, Socket } from "socket.io-client";
import Peer from "simple-peer";
// @ts-ignore
import wrtc from "wrtc";
import http from "http";

const SIGNALING = "http://SEU_SERVIDOR:3000";
const TUNNEL_ID = process.argv[2] || "meu-tunel";

console.log("[Client] Iniciando client com ID:", TUNNEL_ID);
const socket: Socket = io(SIGNALING);

socket.on("connect", () =>
  console.log("[Client] Conectado ao servidor de sinalização", socket.id)
);
socket.emit("register", { role: "client", id: TUNNEL_ID });
console.log("[Client] Registro enviado ao servidor");

const peer = new Peer({ initiator: false, wrtc });

peer.on("signal", (data) => {
  console.log("[Client] Gerado sinal:", data);
  socket.emit("signal", { role: "client", id: TUNNEL_ID, data });
});

socket.on("signal", (data) => {
  console.log("[Client] Sinal recebido do servidor:", data);
  peer.signal(data);
});

peer.on("connect", () => {
  console.log("[Client] DataChannel aberto"); // :contentReference[oaicite:16]{index=16}

  // Proxy HTTP local
  const server = http.createServer((req, res) => {
    console.log("[Client] Proxy HTTP — requisição:", req.method, req.url);
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
      console.log("[Client] Proxy HTTP — resposta", msg.statusCode);
      res.writeHead(msg.statusCode, msg.headers);
      res.write(Buffer.from(msg.body, "base64"));
      res.end();
    });
  });

  server.listen(8081, () => {
    console.log("[Client] Proxy HTTP rodando em http://localhost:8081"); // :contentReference[oaicite:17]{index=17}
  });
});

peer.on(
  "error",
  (err) => console.error("[Client] Peer error:", err) // :contentReference[oaicite:18]{index=18}
);
