import { createServer } from "http";
import { Server } from "socket.io";

const httpServer = createServer();
const io = new Server(httpServer);

// Middleware para logar tentativas de conexão
io.use((socket, next) => {
  console.log("[Server] Tentativa de conexão:", socket.id);
  next();
}); // :contentReference[oaicite:5]{index=5}

io.on("connection", (socket) => {
  console.log(`[Server] Cliente conectado: ${socket.id}`); // conexão :contentReference[oaicite:6]{index=6}

  socket.on("register", ({ role, id }) => {
    console.log(`[Server] Registro de ${role} com ID=${id}`);
    socket.join(`${id}:${role}`);
  });

  socket.on("signal", ({ role, id, data }) => {
    console.log(`[Server] Sinal recebido de ${role} (ID=${id}):`, data);
    const target = role === "host" ? "client" : "host";
    io.to(`${id}:${target}`).emit("signal", data);
    console.log(`[Server] Sinal reenviado para ${target}`);
  });

  socket.on("disconnect", (reason) => {
    console.log(
      `[Server] Cliente desconectado: ${socket.id}, motivo: ${reason}`
    ); // :contentReference[oaicite:7]{index=7}
  });

  socket.on("error", (err) => {
    console.error(`[Server] Erro no socket ${socket.id}:`, err);
  });
});

httpServer.listen(3000, () => {
  console.log("[Server] Sinalização rodando em http://localhost:3000"); // :contentReference[oaicite:8]{index=8}
});
