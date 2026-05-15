import Redis from "ioredis";
import { createAdapter } from "@socket.io/redis-adapter";
import { Server } from "socket.io";

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

export const attachSocketRedisAdapter = async (io: Server) => {
    const pubClient = new Redis(redisUrl);
    const subClient = pubClient.duplicate();

    pubClient.on("connect", () => {
        console.log("Socket.IO Redis adapter publisher connected");
    });

    subClient.on("connect", () => {
        console.log("Socket.IO Redis adapter subscriber connected");
    });

    pubClient.on("error", (err) => {
        console.error("Socket.IO Redis adapter publisher error:", err);
    });

    subClient.on("error", (err) => {
        console.error("Socket.IO Redis adapter subscriber error:", err);
    });

    io.adapter(createAdapter(pubClient, subClient));

    console.log("Socket.IO Redis adapter attached");
};
