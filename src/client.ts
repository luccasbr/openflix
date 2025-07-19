import { io, Socket as IOSocket } from "socket.io-client";
import Peer from "simple-peer";
// @ts-ignore
import wrtc from "wrtc";
import * as http from "http";
import { Socket as NetSocket } from "net";
import { v4 as uuid } from "uuid";

const SIGNALING = "http://15.228.71.40:3000";
const TUNNEL_ID = process.argv[2] || "meu-tunel";

console.log("[Client] Iniciando client, ID =", TUNNEL_ID);
const socket: IOSocket = io(SIGNALING);
socket.on("connect", () =>
  console.log("[Client] Conectado ao signaling server", socket.id)
);
socket.emit("register", { role: "client", id: TUNNEL_ID });

const peer = new Peer({ initiator: false, wrtc });

peer.on("signal", (data) => {
  console.log("[Client] Gerado signal:", data);
  socket.emit("signal", { role: "client", id: TUNNEL_ID, data });
});
socket.on("signal", (data) => {
  console.log("[Client] Signal recebido:", data);
  peer.signal(data);
});

peer.on("connect", () => {
  console.log("[Client] DataChannel aberto 🎉");
  startProxy();
});
peer.on("error", (err) => console.error("[Client] Peer error:", err));

// Agora tcpMap guarda NetSocket, não Duplex
const tcpMap = new Map<string, NetSocket>();

function startProxy() {
  const server = http.createServer((req, res) => {
    console.log("[Client] HTTP request (via proxy):", req.method, req.url);
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
      console.log("[Client] HTTP response enviada ao browser");
    });
  });

  // Suporte a CONNECT (HTTPS) com NetSocket
  server.on(
    "connect",
    (req: http.IncomingMessage, clientSocket: NetSocket, head: Buffer) => {
      const [host, portStr] = req.url!.split(":");
      const port = Number(portStr);
      const id = uuid();
      console.log(
        `[Client] CONNECT solicitado para ${host}:${port} (túnel ${id})`
      );

      // Inicia túnel TCP via DataChannel
      peer.send(JSON.stringify({ type: "tcp-init", id, host, port }));
      tcpMap.set(id, clientSocket);

      // Notifica navegador de que o túnel está pronto
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

      clientSocket.on("data", (chunk) => {
        peer.send(
          JSON.stringify({
            type: "tcp-data",
            id,
            data: chunk.toString("base64"),
          })
        );
      });
      clientSocket.on("end", () => {
        peer.send(JSON.stringify({ type: "tcp-end", id }));
        tcpMap.delete(id);
      });
    }
  );

  // Recebe dados do Host para túneis TCP
  peer.on("data", (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "tcp-data") {
      const sock = tcpMap.get(msg.id);
      if (sock) sock.write(Buffer.from(msg.data, "base64"));
    }
    if (msg.type === "tcp-end") {
      const sock = tcpMap.get(msg.id);
      if (sock) {
        sock.end();
        tcpMap.delete(msg.id);
      }
    }
  });

  server.listen(8081, () =>
    console.log("[Client] HTTP/S proxy rodando em http://localhost:8081")
  );
}
