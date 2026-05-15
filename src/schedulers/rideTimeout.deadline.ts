import { redisCache, RIDE_RESPONSE_TIMEOUTS_KEY } from "../config/redis";

export type RideTimeoutPayload = {
    rideId: string;
    assignmentVersion: number;
};

export const encodeRideTimeoutPayload = (payload: RideTimeoutPayload) => {
    return JSON.stringify(payload);
};

export const decodeRideTimeoutPayload = (value: string): RideTimeoutPayload => {
    return JSON.parse(value);
};

export const scheduleRideResponseTimeout = async (
    rideId: string,
    assignmentVersion: number,
    expiresAt: Date
) => {
    await redisCache.zadd(
        RIDE_RESPONSE_TIMEOUTS_KEY,
        expiresAt.getTime(),
        encodeRideTimeoutPayload({
            rideId,
            assignmentVersion,
        })
    );
};

export const removeRideResponseTimeout = async (
    rideId: string,
    assignmentVersion: number
) => {
    await redisCache.zrem(
        RIDE_RESPONSE_TIMEOUTS_KEY,
        encodeRideTimeoutPayload({
            rideId,
            assignmentVersion,
        })
    );
};
