import { redisCache } from "../config/redis";



const DRIVER_PROFILE_CACHE_TTL_SECONDS = 60;



const getDriverProfileCacheKey = (driverId: string) => {
    return `driver:profile:${driverId}`;
};

const toCachedDriverProfile = (driver: any) => {
    return {
        _id: driver._id,
        name: driver.name,
        phone: driver.phone,
        vehicle: driver.vehicle,
        rating: driver.rating,
        petFriendly: driver.petFriendly,
        airportTripsCount: driver.airportTripsCount,
        languages: driver.languages,
        serviceTags: driver.serviceTags,
        preferredRideTypes: driver.preferredRideTypes,
        embeddingStatus: driver.embeddingStatus,
    };
};


//makes redioskeys beecoz redis stores it in key and value pairs
export const getCachedDriverProfiles = async (driverIds: string[]) => {

    //if nodriver array return empty map
    if (driverIds.length === 0) {
        return new Map<string, any>();
    }

    const keys = driverIds.map(getDriverProfileCacheKey);

    //.mget -> Fetch many redis keys in one network call
    const cachedValues = await redisCache.mget(...keys);
    const profilesById = new Map<string, any>();

    cachedValues.forEach((value, index) => {
        if (!value) {
            return;
        }

        try {
            profilesById.set(driverIds[index], JSON.parse(value));
        } catch {
            // Ignore bad cache data. Mongo will refresh it.
        }
    });

    return profilesById;
};

export const setCachedDriverProfiles = async (drivers: any[]) => {
    if (drivers.length === 0) {
        return;
    }

    //batches data and sends all together
    const pipeline = redisCache.pipeline();

    drivers.forEach((driver) => {
        const profile = toCachedDriverProfile(driver);

        pipeline.set(
            getDriverProfileCacheKey(String(driver._id)),
            JSON.stringify(profile),
            "EX",
            DRIVER_PROFILE_CACHE_TTL_SECONDS
        );
    });

    await pipeline.exec();
};
