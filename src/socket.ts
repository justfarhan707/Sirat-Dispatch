import { Server, Socket } from "socket.io";

let io: Server;

export const initSocket = (socketServer: Server) => {
    io = socketServer;

    io.on("connection", (socket: Socket) => {
        console.log(`socket connected ${socket.id}`);

        socket.on("subscribe:driver", (driverId: string) => {
            const roomName = `driver:${driverId}`;
            socket.join(roomName);
            console.log(`socket ${socket.id} joined room ${roomName}`);
        });

        socket.on("unsubscribe:driver", (driverId: string) => {
            const roomName = `driver:${driverId}`;
            socket.leave(roomName);
            console.log(`socket ${socket.id} left room ${roomName}`);
        });

        socket.on("subscribe:h3", (h3Index: string) => {
            const roomName = `h3:${h3Index}`;
            socket.join(roomName);
            console.log(`socket ${socket.id} joined room ${roomName}`);
        });

        socket.on("unsubscribe:h3", (h3Index: string) => {
            const roomName = `h3:${h3Index}`;
            socket.leave(roomName);
            console.log(`socket ${socket.id} left room ${roomName}`);
        });

        socket.on("disconnect", () => {
            console.log(`socket disconnected ${socket.id}`);
        });

        socket.on("subscribe:ride", (rideId: string) => {
            socket.join(`ride:${rideId}`);
        });

        socket.on("unsubscribe:ride", (rideId: string) => {
            socket.leave(`ride:${rideId}`);
        });
    });
};

export const getIO = () => {
    if (!io) {
        throw new Error("Socket.IO is not initialized");
    }

    return io;
};
