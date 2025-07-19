// host.ts
import { io, Socket } from "socket.io-client";
import Peer from "simple-peer";
// @ts-ignore
import wrtc from "wrtc";
import fetch from "node-fetch";
import http from "http";

const SIGNALING = "http://SEU_SERVIDOR:3000";
const TUNNEL_ID = process.argv[2] || "meu-tunel";

const socket: Socket = io(SIGNALING);
socket.emit("register", { role: "host", id: TUNNEL_ID });

const peer = new Peer({
  initiator: true,
  wrtc,
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      // opcional: TURN
    ],
  },
});

peer.on("signal", (data) =>
  socket.emit("signal", { role: "host", id: TUNNEL_ID, data })
);
socket.on("signal", (data) => peer.signal(data));

peer.on("connect", () => console.log("Host: DataChannel ativo"));

peer.on("data", async (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "http") {
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
  }
});

// HTTP proxy local
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
  .listen(8080, () => console.log("Host: proxy HTTP em http://localhost:8080"));
