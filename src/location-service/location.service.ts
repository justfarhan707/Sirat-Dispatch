import { H3Service } from "../services/h3.service";
import { locationRedis } from "./location.redis";
import { redisPub } from "../config/redis";
import { DRIVER_LOCATION_UPDATED_CHANNEL } from "../pubsub/driverLocation.pubsub";


export type LiveDriverLocation = {
    driverId: string;
    lat: number;
    lng: number;
    h3Index: string;
    isAvailable: boolean;
    updatedAt: string;
};

const getLiveDriverKey = (driverId: string) => {
    return `driver:live:${driverId}`;
};

const getH3DriversKey = (h3Index: string) => {
    return `drivers:h3:${h3Index}`;
};

const ACTIVE_DRIVERS_KEY = "drivers:active";

export const updateLiveDriverLocation = async (
    driverId: string,
    lat: number,
    lng: number,
    isAvailable?: boolean
): Promise<LiveDriverLocation> => {
    const liveDriverKey = getLiveDriverKey(driverId);  // used to look for previous data in redis
    const previousRaw = await locationRedis.get(liveDriverKey); // previous stored strings check 

    const previous = previousRaw ? JSON.parse(previousRaw) : null;
    const previousH3Index = previous?.h3Index;  //if previous get h3Index

    const h3Index = H3Service.getIndex(lat, lng);
    const updatedAt = new Date().toISOString();

    //store values inlivesate and follow the type
    const liveState: LiveDriverLocation = {
        driverId,
        lat,
        lng,
        h3Index,
        isAvailable:
            typeof isAvailable === "boolean"
                ? isAvailable
                : previous?.isAvailable ?? true,
        updatedAt,
    };


    if (previousH3Index && previousH3Index !== h3Index) {
        await locationRedis.srem(getH3DriversKey(previousH3Index), driverId);
    }

    await locationRedis.set(liveDriverKey, JSON.stringify(liveState));
    await locationRedis.sadd(getH3DriversKey(h3Index), driverId);
    await locationRedis.sadd(ACTIVE_DRIVERS_KEY, driverId);

    await redisPub.publish(
        DRIVER_LOCATION_UPDATED_CHANNEL,
        JSON.stringify({
            driverId,
            location: {
                type: "Point",
                coordinates: [lng, lat],
            },
            h3Index,
            isAvailable: liveState.isAvailable,
            lastSeen: updatedAt,
        })
    );


    return liveState;
};


export const findNearbyLiveDrivers = async (
    lat: number,
    lng: number,
    ringSize: number
): Promise<LiveDriverLocation[]> => {
    const h3Index = H3Service.getIndex(lat, lng);
    const nearbyH3Indexes = H3Service.getNeighbours(h3Index, ringSize);

    const driverIds = new Set<string>();

    for (const nearbyH3Index of nearbyH3Indexes) {
        const ids = await locationRedis.smembers(getH3DriversKey(nearbyH3Index));

        ids.forEach((driverId) => {
            driverIds.add(driverId);
        });
    }

    if (driverIds.size === 0) {
        return [];
    }

    const liveDriverKeys = [...driverIds].map((driverId) =>
        getLiveDriverKey(driverId)
    );

    const liveDriverValues = await locationRedis.mget(...liveDriverKeys);

    return liveDriverValues
        .filter((value): value is string => Boolean(value))
        .map((value) => JSON.parse(value))
        .filter((driver: LiveDriverLocation) => driver.isAvailable);
};


export const updateLiveDriverAvailability = async (driverId: string, isAvailable: boolean): Promise<LiveDriverLocation | null> => {
    const liveDriverKey = getLiveDriverKey(driverId);
    const liveDriverRaw = await locationRedis.get(liveDriverKey);

    if (!liveDriverRaw) {
        return null;
    }

    const liveDriver: LiveDriverLocation = JSON.parse(liveDriverRaw);

    const updatedLiveDriver: LiveDriverLocation = {
        ...liveDriver,
        isAvailable,
        updatedAt: new Date().toISOString(),
    };

    await locationRedis.set(
        liveDriverKey,
        JSON.stringify(updatedLiveDriver)
    );

    await redisPub.publish(
        DRIVER_LOCATION_UPDATED_CHANNEL,
        JSON.stringify({
            driverId,
            location: {
                type: "Point",
                coordinates: [updatedLiveDriver.lng, updatedLiveDriver.lat],
            },
            h3Index: updatedLiveDriver.h3Index,
            isAvailable: updatedLiveDriver.isAvailable,
            lastSeen: updatedLiveDriver.updatedAt,
        })
    );

    return updatedLiveDriver;
}
