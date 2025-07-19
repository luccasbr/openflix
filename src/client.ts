import { io, Socket } from "socket.io-client";
import Peer from "simple-peer";
// @ts-ignore
import wrtc from "wrtc";
import http from "http";

const SIGNALING = "http://15.228.71.40:3000";
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

// Map para armazenar conexões de túnel ativas
const tunnelConnections = new Map();

peer.on("connect", () => {
  console.log("[Client] DataChannel aberto");

  // Proxy HTTP local com suporte a CONNECT
  const server = http.createServer((req, res) => {
    console.log("[Client] Proxy HTTP — requisição:", req.method, req.url);
    
    // Para requisições HTTP normais
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

  // Lidar com método CONNECT para túneis HTTPS
  server.on('connect', (req, clientSocket, head) => {
    console.log("[Client] Proxy CONNECT — estabelecendo túnel para:", req.url);
    
    const tunnelId = Math.random().toString(36).substring(7);
    const [hostname, port] = req.url!.split(':');
    
    // Solicitar ao host para estabelecer conexão TCP
    peer.send(
      JSON.stringify({
        type: "connect",
        tunnelId,
        hostname,
        port: parseInt(port!) || 443,
      })
    );

    // Aguardar confirmação do host
    const handleTunnelResponse = (raw: any) => {
      const msg = JSON.parse(raw.toString());
      
      if (msg.type === "connect_response" && msg.tunnelId === tunnelId) {
        if (msg.success) {
          console.log("[Client] Túnel estabelecido com sucesso");
          
          // Enviar resposta de conexão estabelecida
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          
          // Armazenar a conexão do cliente
          tunnelConnections.set(tunnelId, clientSocket);
          
          // Repassar dados do cliente para o host
          clientSocket.on('data', (data) => {
            peer.send(
              JSON.stringify({
                type: "tunnel_data",
                tunnelId,
                data: data.toString('base64'),
              })
            );
          });
          
          // Lidar com fechamento da conexão
          clientSocket.on('close', () => {
            console.log("[Client] Conexão do cliente fechada");
            tunnelConnections.delete(tunnelId);
            peer.send(
              JSON.stringify({
                type: "tunnel_close",
                tunnelId,
              })
            );
          });
          
          clientSocket.on('error', (err) => {
            console.error("[Client] Erro na conexão do cliente:", err);
            tunnelConnections.delete(tunnelId);
            peer.send(
              JSON.stringify({
                type: "tunnel_close",
                tunnelId,
              })
            );
          });
          
        } else {
          console.error("[Client] Falha ao estabelecer túnel:", msg.error);
          clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
          clientSocket.end();
        }
        
        peer.off('data', handleTunnelResponse);
      }
    };
    
    peer.on('data', handleTunnelResponse);
    
    // Timeout para conexão
    setTimeout(() => {
      peer.off('data', handleTunnelResponse);
      if (!tunnelConnections.has(tunnelId)) {
        console.error("[Client] Timeout ao estabelecer túnel");
        clientSocket.write('HTTP/1.1 504 Gateway Timeout\r\n\r\n');
        clientSocket.end();
      }
    }, 10000);
  });

  server.listen(8081, () => {
    console.log("[Client] Proxy HTTP rodando em http://localhost:8081");
  });
});

// Lidar com dados de túnel recebidos do host
peer.on("data", (raw) => {
  try {
    const msg = JSON.parse(raw.toString());
    
    if (msg.type === "tunnel_data" && tunnelConnections.has(msg.tunnelId)) {
      const clientSocket = tunnelConnections.get(msg.tunnelId);
      clientSocket.write(Buffer.from(msg.data, 'base64'));
    }
    
    if (msg.type === "tunnel_close" && tunnelConnections.has(msg.tunnelId)) {
      const clientSocket = tunnelConnections.get(msg.tunnelId);
      clientSocket.end();
      tunnelConnections.delete(msg.tunnelId);
    }
    
  } catch (err) {
    // Se não for JSON ou for mensagem HTTP normal, ignorar aqui
    // (será tratado pelos listeners HTTP existentes)
  }
});

peer.on(
  "error",
  (err) => console.error("[Client] Peer error:", err)
);

