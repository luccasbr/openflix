import { io, Socket } from "socket.io-client";
import Peer from "simple-peer";
// @ts-ignore
import wrtc from "wrtc";
import fetch from "node-fetch";
import http from "http";
import net from "net";

const SIGNALING = "http://15.228.71.40:3000";
const TUNNEL_ID = process.argv[2] || "meu-tunel";

console.log("[Host] Iniciando host, ID =", TUNNEL_ID);
const socket: Socket = io(SIGNALING);

// Mapa para sockets TCP de túneis HTTPS
const tcpSockets = new Map<string, net.Socket>();

socket.on("connect", () =>
  console.log("[Host] Conectado ao signaling server", socket.id)
);
socket.emit("register", { role: "host", id: TUNNEL_ID });

const peer = new Peer({ initiator: true, wrtc });
peer.on("signal", (data) => {
  console.log("[Host] Gerado signal:", data);
  socket.emit("signal", { role: "host", id: TUNNEL_ID, data });
});
socket.on("signal", (data) => {
  console.log("[Host] Signal recebido:", data);
  peer.signal(data);
});

peer.on("connect", () => console.log("[Host] DataChannel aberto 🎉"));

peer.on("error", (err) => console.error("[Host] Peer error:", err));

peer.on("data", async (raw) => {
  // tenta parsear JSON
  let msg: any;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    console.error("[Host] Mensagem não-JSON recebida");
    return;
  }

  switch (msg.type) {
    // 1) Requisição HTTP “normal”
    case "http": {
      console.log("[Host] HTTP request para", msg.url);
      try {
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
        console.log("[Host] HTTP response enviada");
      } catch (e) {
        console.error("[Host] Erro no fetch HTTP:", e);
      }
      break;
    }

    // 2) Início de túnel TCP (CONNECT)
    case "tcp-init": {
      const { id, host, port } = msg;
      console.log(`[Host] Iniciando túnel TCP [${id}] → ${host}:${port}`);
      const sock = net.connect(port, host, () =>
        console.log(`[Host] TCP socket conectado [${id}]`)
      );
      tcpSockets.set(id, sock);

      sock.on("data", (data) => {
        peer.send(
          JSON.stringify({
            type: "tcp-data",
            id,
            data: data.toString("base64"),
          })
        );
      });
      sock.on("end", () => {
        console.log(`[Host] TCP socket encerrado [${id}]`);
        peer.send(JSON.stringify({ type: "tcp-end", id }));
        tcpSockets.delete(id);
      });
      sock.on("error", (err) => {
        console.error(`[Host] Erro no socket TCP [${id}]:`, err);
        peer.send(
          JSON.stringify({
            type: "tcp-error",
            id,
            message: err.message,
          })
        );
        tcpSockets.delete(id);
      });
      break;
    }

    // 3) Dados brutos para o túnel TCP
    case "tcp-data": {
      const { id, data } = msg;
      const sock = tcpSockets.get(id);
      if (sock) sock.write(Buffer.from(data, "base64"));
      break;
    }

    // 4) Fechamento do túnel TCP
    case "tcp-end": {
      const { id } = msg;
      const sock = tcpSockets.get(id);
      if (sock) {
        sock.end();
        tcpSockets.delete(id);
        console.log(`[Host] Socket TCP [${id}] finalizado por client`);
      }
      break;
    }
  }
});

// Proxy HTTP local para GET/POST
const httpServer = http.createServer((req, res) => {
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
    res.writeHead(msg.statusCode, msg.headers);
    res.write(Buffer.from(msg.body, "base64"));
    res.end();
    console.log("[Host] Proxy HTTP — resposta enviada");
  });
});

httpServer.listen(8080, () =>
  console.log("[Host] HTTP proxy rodando em http://localhost:8080")
);
