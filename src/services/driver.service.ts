import Driver from "../models/driver.model";
import { H3Service } from "./h3.service";
import { generateQueryEmbedding } from "./embedding.service";
import { cosineSimilarity } from "../utils/similarity";
import { findNearbyLiveDrivers } from "../clients/location.client";
import {
    getCachedDriverProfiles,
    setCachedDriverProfiles,
} from "../cache/driverProfile.cache";


export const findNearbyDriversByRing = async (
    lat: number,
    lng: number,
    ringSize: number
) => {

    // Get nearby live drivers from Redis GEO -> [{ driverId, lat, lng }]
    const liveDrivers = await findNearbyLiveDrivers(lat, lng, ringSize);

    // Return early if no nearby drivers found
    if (liveDrivers.length === 0) {
        return [];
    }

    // Extract only driver IDs -> ["d1", "d2"]
    const driverIds = liveDrivers.map((driver) => driver.driverId);

    // Fetch cached driver profiles from Redis -> Map { "d1" => { _id, name, rating } }
    const cachedProfilesById = await getCachedDriverProfiles(driverIds);

    // Find driver IDs missing from cache -> ["d2"]
    const missingDriverIds = driverIds.filter(
        (driverId) => !cachedProfilesById.has(driverId)
    );

    // Fetch only missing driver profiles from Mongo -> [{ _id, name, rating }]
    const missingDrivers = await Driver.find({
        _id: { $in: missingDriverIds },
        isAvailable: true,
        availabilityStatus: "available",
        currentRide: null,
    })
        .select(
            "_id name phone vehicle rating petFriendly airportTripsCount languages serviceTags preferredRideTypes embeddingStatus"
        )
        .lean();

    // Store missing Mongo drivers into Redis cache
    await setCachedDriverProfiles(missingDrivers);

    // Combined profile map -> Map { "d1" => profile, "d2" => profile }
    const driverProfileById = new Map<string, any>(cachedProfilesById);

    // Add Mongo-fetched drivers into combined profile map
    missingDrivers.forEach((driver: any) => {
        driverProfileById.set(String(driver._id), driver);
    });

    // Live location map -> Map { "d1" => { lat, lng }, "d2" => { lat, lng } }
    const liveDriverById = new Map(
        liveDrivers.map((driver) => [driver.driverId, driver])
    );

    // Merge profile data + live location into final response
    return driverIds
        .map((driverId) => {
            const driver = driverProfileById.get(driverId);
            const liveLocation = liveDriverById.get(driverId);

            if (!driver || !liveLocation) {
                return null;
            }

            if (liveLocation.isAvailable === false) {
                return null;
            }

            return {
                ...driver,
                isAvailable: true,
                availabilityStatus: "available",
                currentRide: null,
                liveLocation,
            };
        })
        .filter(Boolean);

};

export const listDriversForConsole = async () => {
    const drivers = await Driver.find({})
        .select("_id name phone vehicle rating isAvailable availabilityStatus currentRide")
        .sort({ createdAt: 1 })
        .limit(100)
        .lean();

    return drivers.sort((a: any, b: any) => {
        const aNumber = Number(String(a.name).replace(/\D/g, ""));
        const bNumber = Number(String(b.name).replace(/\D/g, ""));

        return aNumber - bNumber;
    });
};



export const findNearbyDriverMarkersByRing = async (
    lat: number,
    lng: number,
    ringSize: number
) => {
    const liveDrivers = await findNearbyLiveDrivers(lat, lng, ringSize);

    if (liveDrivers.length === 0) {
        return [];
    }

    const availableLiveDrivers = liveDrivers.filter(
        (driver: any) => driver.isAvailable !== false
    );

    if (availableLiveDrivers.length === 0) {
        return [];
    }

    const driverIds = availableLiveDrivers.map((driver) => driver.driverId);

    const cachedProfilesById = await getCachedDriverProfiles(driverIds);

    const missingDriverIds = driverIds.filter(
        (driverId) => !cachedProfilesById.has(driverId)
    );

    const missingDrivers = await Driver.find({
        _id: { $in: missingDriverIds },
        isAvailable: true,
        availabilityStatus: "available",
        currentRide: null,
    })
        .select("_id name vehicle rating embeddingStatus")
        .lean();

    await setCachedDriverProfiles(missingDrivers);

    const driverProfileById = new Map<string, any>(cachedProfilesById);

    missingDrivers.forEach((driver: any) => {
        driverProfileById.set(String(driver._id), driver);
    });

    return availableLiveDrivers
        .map((liveDriver: any) => {
            const driver = driverProfileById.get(liveDriver.driverId);

            if (!driver) {
                return null;
            }

            return {
                _id: String(driver._id),
                driverId: String(driver._id),
                name: driver.name,
                vehicle: {
                    type: driver.vehicle?.type,
                },
                rating: driver.rating,
                liveLocation: liveDriver,
            };
        })
        .filter(Boolean);
};




export const findNearbyDrivers = async (lat: number, lng: number) => {
    return findNearbyDriversByRing(lat, lng, 2);
};


export const updateDriverLocation = async (
    driverId: string,
    lat: number,
    lng: number,
    isAvailable?: boolean
) => {
    const existingDriver = await Driver.findById(driverId);

    if (!existingDriver) {
        return null;
    }

    const newH3Index = H3Service.getIndex(lat, lng);

    const updateData: {
        location: { type: "Point"; coordinates: [number, number] };
        h3Index: string;
        lastSeen: Date;
        isAvailable?: boolean;
    } = {
        location: {
            type: "Point",
            coordinates: [lng, lat],
        },
        h3Index: newH3Index,
        lastSeen: new Date(),
    };

    if (typeof isAvailable === "boolean") {
        updateData.isAvailable = isAvailable;
    }

    return Driver.findByIdAndUpdate(
        driverId,
        updateData,
        { returnDocument: "after" }
    );
};



export const markDriverEmbeddingPending = async (driverId: string) => {
    return Driver.findByIdAndUpdate(
        driverId,
        {
            embeddingStatus: "pending",
        },
        { returnDocument: "after" }
    );
};

export const markDriverEmbeddingCompleted = async (
    driverId: string,
    profileText: string,
    embedding: number[]
) => {
    return Driver.findByIdAndUpdate(
        driverId,
        {
            profileText,
            embedding,
            embeddingStatus: "completed",
            embeddingUpdatedAt: new Date(),
        },
        { returnDocument: "after" }
    );
};

export const markDriverEmbeddingFailed = async (driverId: string) => {
    return Driver.findByIdAndUpdate(
        driverId,
        {
            embeddingStatus: "failed",
            embeddingUpdatedAt: new Date(),
        },
        { returnDocument: "after" }
    );
};

type RankedDriver = {
    embedding: number[];
    embeddingStatus: string;
    similarityScore: number;
    [key: string]: any;
};




const SEMANTIC_MATCH_THRESHOLD = Number(process.env.SEMANTIC_MATCH_THRESHOLD || 0.6);

export type SemanticMatchReason =
    | "matched"
    | "no_nearby_drivers"
    | "no_driver_embeddings"
    | "below_similarity_threshold"
    | "unsupported_sensitive_attribute";

const queryRequestsUnsupportedSensitiveAttribute = (query: string) => {
    const normalizedQuery = query.toLowerCase();
    const sensitiveAttributePatterns = [
        /\bgay\b/,
        /\blesbian\b/,
        /\bbisexual\b/,
        /\btransgender\b/,
        /\btrans\b/,
        /\bqueer\b/,
        /\blgbt\b/,
        /\blgbtq\b/,
        /\bmuslim\b/,
        /\bhindu\b/,
        /\bchristian\b/,
        /\bjewish\b/,
        /\bsikh\b/,
    ];

    return sensitiveAttributePatterns.some((pattern) => pattern.test(normalizedQuery));
};

export async function rankDriversByIntentWithMetadata(drivers: any[], query: string) {
    if (queryRequestsUnsupportedSensitiveAttribute(query)) {
        return {
            drivers: [],
            reason: "unsupported_sensitive_attribute",
            eligibleDriverCount: 0,
        };
    }

    if (!drivers.length) {
        return { drivers: [], reason: "no_nearby_drivers", eligibleDriverCount: 0 };
    }

    const driverIds = drivers.map((driver) => driver._id);
    const driversWithEmbeddings = await Driver.find({
        _id: { $in: driverIds },
        embeddingStatus: "completed",
    })
        .select("_id embedding embeddingStatus")
        .lean();

    const embeddingsByDriverId = new Map(
        driversWithEmbeddings.map((driver: any) => [String(driver._id), driver])
    );

    const hydratedDrivers = drivers.map((driver) => {
        const embeddingData = embeddingsByDriverId.get(String(driver._id));

        return {
            ...driver,
            embedding: embeddingData?.embedding,
            embeddingStatus: embeddingData?.embeddingStatus || driver.embeddingStatus,
        };
    });

    const eligibleDrivers = hydratedDrivers.filter((driver) => {
        return driver.embeddingStatus === "completed"
            && Array.isArray(driver.embedding)
            && driver.embedding.length > 0;
    });

    if (!eligibleDrivers.length) {
        return { drivers: [], reason: "no_driver_embeddings", eligibleDriverCount: 0 };
    }

    const queryEmbedding = await generateQueryEmbedding(query);

    const rankedDrivers = eligibleDrivers
        .map((driver) => ({
            ...driver,
            similarityScore: cosineSimilarity(queryEmbedding, driver.embedding),
        }))
        .sort((a, b) => b.similarityScore - a.similarityScore);

    const matchedDrivers = rankedDrivers.filter((driver) => {
        return driver.similarityScore >= SEMANTIC_MATCH_THRESHOLD;
    });

    if (!matchedDrivers.length) {
        return {
            drivers: [],
            reason: "below_similarity_threshold",
            eligibleDriverCount: eligibleDrivers.length,
        };
    }

    return {
        drivers: matchedDrivers,
        reason: "matched",
        eligibleDriverCount: eligibleDrivers.length,
    };
}



export async function rankDriversByIntent(drivers: any[], query: string) {
    const result = await rankDriversByIntentWithMetadata(drivers, query);
    return result.drivers;
}

export const matchDriversByIntent = async (
    lat: number,
    lng: number,
    query: string
) => {
    const nearbyDrivers = await findNearbyDrivers(lat, lng);

    return rankDriversByIntent(nearbyDrivers, query)
};



