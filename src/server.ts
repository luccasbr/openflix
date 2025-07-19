// server.ts
import { createServer } from "http";
import { Server } from "socket.io";

const httpServer = createServer();
const io = new Server(httpServer);

io.on("connection", (socket) => {
  // client e host em rooms pelo mesmo id
  socket.on("register", ({ role, id }) => {
    socket.join(`${id}:${role}`);
  });
  // retransmite sinal para o peer oposto
  socket.on("signal", ({ role, id, data }) => {
    const target = role === "host" ? "client" : "host";
    io.to(`${id}:${target}`).emit("signal", data);
  });
});

httpServer.listen(3000, () =>
  console.log("Signaling server rodando na porta 3000")
);
