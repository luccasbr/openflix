import { io, Socket } from "socket.io-client";
import Peer from "simple-peer";
// @ts-ignore
import wrtc from "wrtc";
import fetch from "node-fetch";
import http from "http";
import net from "net";

const SIGNALING = "http://15.228.71.40:3000";
const TUNNEL_ID = process.argv[2] || "meu-tunel";

console.log("[Host] Iniciando host com ID:", TUNNEL_ID);
const socket: Socket = io(SIGNALING);

socket.on(
  "connect",
  () => console.log("[Host] Conectado ao servidor de sinalização", socket.id)
);

socket.emit("register", { role: "host", id: TUNNEL_ID });
console.log("[Host] Registro enviado ao servidor");

const peer = new Peer({ initiator: true, wrtc });

peer.on("signal", (data) => {
  console.log("[Host] Gerado sinal:", data);
  socket.emit("signal", { role: "host", id: TUNNEL_ID, data });
});

socket.on("signal", (data) => {
  console.log("[Host] Sinal recebido do servidor:", data);
  peer.signal(data);
});

peer.on(
  "connect",
  () => console.log("[Host] DataChannel aberto")
);

// Map para armazenar conexões de túnel ativas
const tunnelConnections = new Map();

peer.on("data", async (raw) => {
  console.log("[Host] Mensagem recebida via DataChannel");
  try {
    const msg = JSON.parse(raw.toString());
    
    // Lidar com requisições HTTP normais
    if (msg.type === "http") {
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
      console.log("[Host] Resposta enviada ao client");
    }
    
    // Lidar com solicitações de conexão CONNECT
    else if (msg.type === "connect") {
      console.log(`[Host] Estabelecendo conexão TCP para ${msg.hostname}:${msg.port}`);
      
      const targetSocket = new net.Socket();
      
      targetSocket.connect(msg.port, msg.hostname, () => {
        console.log(`[Host] Conexão TCP estabelecida para ${msg.hostname}:${msg.port}`);
        
        // Armazenar a conexão
        tunnelConnections.set(msg.tunnelId, targetSocket);
        
        // Enviar confirmação de sucesso
        peer.send(
          JSON.stringify({
            type: "connect_response",
            tunnelId: msg.tunnelId,
            success: true,
          })
        );
        
        // Repassar dados do servidor remoto para o cliente
        targetSocket.on('data', (data) => {
          peer.send(
            JSON.stringify({
              type: "tunnel_data",
              tunnelId: msg.tunnelId,
              data: data.toString('base64'),
            })
          );
        });
        
        // Lidar com fechamento da conexão
        targetSocket.on('close', () => {
          console.log(`[Host] Conexão TCP fechada para ${msg.hostname}:${msg.port}`);
          tunnelConnections.delete(msg.tunnelId);
          peer.send(
            JSON.stringify({
              type: "tunnel_close",
              tunnelId: msg.tunnelId,
            })
          );
        });
        
        targetSocket.on('error', (err) => {
          console.error(`[Host] Erro na conexão TCP para ${msg.hostname}:${msg.port}:`, err);
          tunnelConnections.delete(msg.tunnelId);
          peer.send(
            JSON.stringify({
              type: "tunnel_close",
              tunnelId: msg.tunnelId,
            })
          );
        });
      });
      
      targetSocket.on('error', (err) => {
        console.error(`[Host] Falha ao conectar em ${msg.hostname}:${msg.port}:`, err);
        peer.send(
          JSON.stringify({
            type: "connect_response",
            tunnelId: msg.tunnelId,
            success: false,
            error: err.message,
          })
        );
      });
    }
    
    // Lidar com dados de túnel
    else if (msg.type === "tunnel_data" && tunnelConnections.has(msg.tunnelId)) {
      const targetSocket = tunnelConnections.get(msg.tunnelId);
      targetSocket.write(Buffer.from(msg.data, 'base64'));
    }
    
    // Lidar com fechamento de túnel
    else if (msg.type === "tunnel_close" && tunnelConnections.has(msg.tunnelId)) {
      const targetSocket = tunnelConnections.get(msg.tunnelId);
      targetSocket.end();
      tunnelConnections.delete(msg.tunnelId);
    }
    
  } catch (err) {
    console.error("[Host] Erro ao processar mensagem:", err);
  }
});

peer.on(
  "error",
  (err) => console.error("[Host] Peer error:", err)
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
  console.log("[Host] Proxy HTTP rodando em http://localhost:8080");
});

