import { redisPub, redisSub } from "../config/redis";
import { getIO } from "../socket";

export const DISPATCH_EVENT_CHANNEL = "dispatch:event";

export type DispatchEventPayload = {
    event: string;
    timestamp: string;
    rideId?: string;
    driverId?: string;
    [key: string]: unknown;
};

export const publishDispatchEvent = async (payload: DispatchEventPayload) => {
    await redisPub.publish(DISPATCH_EVENT_CHANNEL, JSON.stringify(payload));
};

export const subscribeToDispatchEvents = async () => {
    await redisSub.subscribe(DISPATCH_EVENT_CHANNEL);

    redisSub.on("message", (channel, message) => {
        if (channel !== DISPATCH_EVENT_CHANNEL) {
            return;
        }

        try {
            const payload = JSON.parse(message);
            const io = getIO();

            io.emit("dispatch:event", payload);

            if (payload.rideId) {
                io.to(`ride:${payload.rideId}`).emit("dispatch:event", payload);
            }

            if (payload.driverId) {
                io.to(`driver:${payload.driverId}`).emit("dispatch:event", payload);
            }
        } catch (err) {
            console.error("Failed to handle dispatch event:", err);
        }
    });
};