// client.ts
import { io, Socket } from "socket.io-client";
import Peer from "simple-peer";
// @ts-ignore
import wrtc from "wrtc";
import http from "http";

const SIGNALING = "http://SEU_SERVIDOR:3000";
const TUNNEL_ID = process.argv[2] || "meu-tunel";

const socket: Socket = io(SIGNALING);
socket.emit("register", { role: "client", id: TUNNEL_ID });

const peer = new Peer({
  initiator: false,
  wrtc,
  config: {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  },
});

peer.on("signal", (data) =>
  socket.emit("signal", { role: "client", id: TUNNEL_ID, data })
);
socket.on("signal", (data) => peer.signal(data));

peer.on("connect", () => {
  console.log("Client: DataChannel ativo");

  http
    .createServer((req, res) => {
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
      });
    })
    .listen(8081, () =>
      console.log("Client: proxy HTTP em http://localhost:8081")
    );
});
