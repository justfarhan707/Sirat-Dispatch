import { redisPub, redisSub } from "../config/redis";
import { getIO } from "../socket";

export const DRIVER_LOCATION_UPDATED_CHANNEL = "driver:location:updated";


//defines whats data travels in the event
type DriverLocationUpdatedEvent = {
    driverId: string;
    location: {
        type: "Point";
        coordinates: [number, number];
    };
    h3Index: string;
    isAvailable: boolean;
    lastSeen: Date | string;
};



//controller calls the function , Payload → converted to string → sent to Redis(currently useless as we send lkive location from locationservice)
export const publishDriverLocationUpdated = async (payload: DriverLocationUpdatedEvent) => {
    await redisPub.publish(
        DRIVER_LOCATION_UPDATED_CHANNEL,
        JSON.stringify(payload)
    );
};


export const subscribeToDriverLocationUpdates = async () => {
    await redisSub.subscribe(DRIVER_LOCATION_UPDATED_CHANNEL);

    redisSub.on("message", (channel, message) => {
        if (channel !== DRIVER_LOCATION_UPDATED_CHANNEL) return;

        const payload: DriverLocationUpdatedEvent = JSON.parse(message);

        const io = getIO();

        io.to(`driver:${payload.driverId}`).emit(
            "driver:locationUpdated",
            payload
        );

        io.to(`h3:${payload.h3Index}`).emit(
            "driver:locationUpdated",
            payload
        );
    });
}

/*what it does*/
// 1. Publish event → send to Redis
// 2. Subscribe event → receive from Redis → send to Socket