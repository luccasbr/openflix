import { createServer } from "http";
import { Server, Socket } from "socket.io";

const PORT = 3000;
const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: "*" } });

io.on("connection", (socket: Socket) => {
  socket.on(
    "register",
    ({ role, id }: { role: "host" | "client"; id: string }) => {
      const room = `${id}:${role}`;
      socket.join(room);
      console.log(`[Signal] ${role.toUpperCase()} entrou na sala "${room}"`);
      // Se ambos host e client estiverem presentes, sinaliza ready
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
    const target = role === "host" ? "client" : "host";
    io.to(`${id}:${target}`).emit("signal", data);
    console.log(
      `[Signal] Relay de sinal de ${role}→${target} no túnel "${id}"`
    );
  });
});

httpServer.listen(PORT, () => {
  console.log(`[Signal] Server rodando em http://0.0.0.0:${PORT}`);
});
