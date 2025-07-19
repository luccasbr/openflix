// server.ts
import { createServer } from "http";
import { Server, Socket } from "socket.io";

const PORT = 3000;
const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: "*" } });

io.on("connection", (socket: Socket) => {
  console.log(`[Signal] Socket conectado: ${socket.id}`);

  socket.on(
    "register",
    ({ role, id }: { role: "host" | "client"; id: string }) => {
      const room = `${id}:${role}`;
      socket.join(room);
      console.log(
        `[Signal] ${role.toUpperCase()} registrado na sala "${room}"`
      );

      // Se já temos host E client, emite 'ready' para ambos
      const hasHost = io.sockets.adapter.rooms.get(`${id}:host`);
      const hasClient = io.sockets.adapter.rooms.get(`${id}:client`);
      if (hasHost && hasClient) {
        io.to(`${id}:host`).emit("ready");
        io.to(`${id}:client`).emit("ready");
        console.log(`[Signal] Emissão de 'ready' para túnel "${id}"`);
      }
    }
  );

  socket.on("signal", ({ role, id, data }: any) => {
    const targetRoom = `${id}:${role === "host" ? "client" : "host"}`;
    io.to(targetRoom).emit("signal", data);
    console.log(
      `[Signal] Relay de sinal de ${role} → ${
        role === "host" ? "client" : "host"
      } no túnel "${id}"`
    );
  });

  socket.on("disconnect", (reason) => {
    console.log(`[Signal] Socket desconectou: ${socket.id} (${reason})`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[Signal] Servidor rodando em http://0.0.0.0:${PORT}`);
});
