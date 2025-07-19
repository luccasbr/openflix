// server.ts
import { createServer } from "http";
import { Server, Socket } from "socket.io";

const PORT = 3000;
const httpServer = createServer();
const io = new Server(httpServer, {
  // opcional: configurações CORS se precisar de domínio diferente
  cors: { origin: "*" },
});

io.on("connection", (socket: Socket) => {
  console.log(`[Signal] Cliente conectado: ${socket.id}`);

  socket.on(
    "register",
    ({ role, id }: { role: "host" | "client"; id: string }) => {
      const room = `${id}:${role}`;
      socket.join(room);
      console.log(
        `[Signal] ${role.toUpperCase()} registrado no túnel "${id}" (sala "${room}")`
      );
    }
  );

  socket.on(
    "signal",
    ({
      role,
      id,
      data,
    }: {
      role: "host" | "client";
      id: string;
      data: any;
    }) => {
      const target = role === "host" ? "client" : "host";
      const room = `${id}:${target}`;
      console.log(
        `[Signal] Relay de sinal de ${role} → ${target} na sala "${id}"`
      );
      io.to(room).emit("signal", data);
    }
  );

  socket.on("disconnect", (reason) => {
    console.log(`[Signal] Cliente desconectado: ${socket.id} (${reason})`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[Signal] Servidor rodando em http://0.0.0.0:${PORT}`);
});
