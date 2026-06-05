import dotenv from "dotenv";
import mongoose from "mongoose";
import dns from "dns";
import Driver from "../models/driver.model";
import Ride from "../models/ride.model";

dotenv.config();

dns.setServers(["8.8.8.8", "8.8.4.4"]);
dns.setDefaultResultOrder("ipv4first");

type SimulatedDriver = {
    driverId: string;
    lat: number;
    lng: number;
    isAvailable: boolean;
    zoneId: ZoneId;
};

type ZoneId = "vashi" | "kurla";

const LOCATION_SERVICE_URL =
    process.env.LOCATION_SERVICE_URL || "http://localhost:4001";

const SIMULATOR_INTERVAL_MS = 3000;
const MAX_DRIVERS = 200;
const RANDOM_STEP_SIZE = 0.002;
const TARGET_STEP_SIZE = 0.0014;
const TARGET_REACHED_DISTANCE = 0.00025;
const HOT_ZONE_PULL_CHANCE = 0.06;
const HOT_ZONE_PULL_STEP_SIZE = 0.00045;

const ZONES: Record<ZoneId, {
    center: { lat: number; lng: number };
    bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}> = {
    vashi: {
        center: { lat: 19.07, lng: 73.0 },
        bounds: {
            minLat: 19.055,
            maxLat: 19.085,
            minLng: 72.985,
            maxLng: 73.015,
        },
    },
    kurla: {
        center: { lat: 19.0726, lng: 72.8845 },
        bounds: {
            minLat: 19.055,
            maxLat: 19.085,
            minLng: 72.87,
            maxLng: 72.9,
        },
    },
};


const clamp = (value: number, min: number, max: number) => {
    return Math.max(min, Math.min(max, value));
};

const getDistance = (
    from: { lat: number; lng: number },
    to: { lat: number; lng: number }
) => {
    const latDistance = to.lat - from.lat;
    const lngDistance = to.lng - from.lng;

    return Math.sqrt(latDistance ** 2 + lngDistance ** 2);
};

const getRandomLocationInZone = (zoneId: ZoneId) => {
    const { bounds } = ZONES[zoneId];

    return {
        lat: bounds.minLat + Math.random() * (bounds.maxLat - bounds.minLat),
        lng: bounds.minLng + Math.random() * (bounds.maxLng - bounds.minLng),
    };
};

const getDriverZone = (driver: SimulatedDriver) => {
    return ZONES[driver.zoneId];
};

const moveDriver = (driver: SimulatedDriver): SimulatedDriver => {
    const zone = getDriverZone(driver);
    const shouldPullToCenter = Math.random() < HOT_ZONE_PULL_CHANCE;

    if (shouldPullToCenter) {
        return moveDriverTowardTarget(driver, zone.center, HOT_ZONE_PULL_STEP_SIZE);
    }

    const latStep = (Math.random() - 0.5) * RANDOM_STEP_SIZE;
    const lngStep = (Math.random() - 0.5) * RANDOM_STEP_SIZE;

    return {
        ...driver,
        lat: clamp(driver.lat + latStep, zone.bounds.minLat, zone.bounds.maxLat),
        lng: clamp(driver.lng + lngStep, zone.bounds.minLng, zone.bounds.maxLng),
    };
};

const moveDriverTowardTarget = (
    driver: SimulatedDriver,
    target: { lat: number; lng: number },
    stepSize = TARGET_STEP_SIZE
): SimulatedDriver => {
    const zone = getDriverZone(driver);
    const distance = getDistance(driver, target);

    if (distance <= TARGET_REACHED_DISTANCE) {
        return {
            ...driver,
            lat: target.lat,
            lng: target.lng,
        };
    }

    const progress = Math.min(stepSize / distance, 1);
    const latJitter = (Math.random() - 0.5) * 0.00018;
    const lngJitter = (Math.random() - 0.5) * 0.00018;

    return {
        ...driver,
        lat: clamp(
            driver.lat + (target.lat - driver.lat) * progress + latJitter,
            zone.bounds.minLat,
            zone.bounds.maxLat
        ),
        lng: clamp(
            driver.lng + (target.lng - driver.lng) * progress + lngJitter,
            zone.bounds.minLng,
            zone.bounds.maxLng
        ),
    };
};

const updateLocationService = async (driver: SimulatedDriver) => {
    const response = await fetch(`${LOCATION_SERVICE_URL}/location/update`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            driverId: driver.driverId,
            lat: driver.lat,
            lng: driver.lng,
        }),

    });

    if (!response.ok) {
        throw new Error(
            `Location update failed for driver ${driver.driverId}`
        );
    }

    return response.json();
};

const loadDriversFromMongo = async (): Promise<SimulatedDriver[]> => {
    const drivers = await Driver.find({})
        .sort({ createdAt: 1 })
        .limit(MAX_DRIVERS)
        .lean();

    return drivers.map((driver: any, index) => {
        const zoneId: ZoneId = index < Math.ceil(drivers.length / 2)
            ? "vashi"
            : "kurla";
        const { lat, lng } = getRandomLocationInZone(zoneId);

        return {
            driverId: String(driver._id),
            lat,
            lng,
            isAvailable: driver.isAvailable,
            zoneId,
        };
    });
};

const getActiveRideTargetsByDriverId = async () => {
    const activeRides = await Ride.find({
        status: { $in: ["assigned", "ongoing"] },
        assignedDriver: { $ne: null },
    })
        .select("assignedDriver status pickup dropoff")
        .lean();

    const targetsByDriverId = new Map<string, { lat: number; lng: number }>();

    activeRides.forEach((ride: any) => {
        const driverId = String(ride.assignedDriver);
        const target = ride.status === "ongoing" ? ride.dropoff : ride.pickup;

        if (!target) {
            return;
        }

        targetsByDriverId.set(driverId, {
            lat: target.lat,
            lng: target.lng,
        });
    });

    return targetsByDriverId;
};

const startSimulator = async () => {
    const mongoUri = process.env.MONGO_URI;

    if (!mongoUri) {
        throw new Error("MONGO_URI is required");
    }

    await mongoose.connect(mongoUri);
    console.log("Simulator connected to Mongo");

    let drivers = await loadDriversFromMongo();

    if (drivers.length === 0) {
        console.log("No available drivers found for simulator");
        process.exit(0);
    }

    const vashiCount = drivers.filter((driver) => driver.zoneId === "vashi").length;
    const kurlaCount = drivers.filter((driver) => driver.zoneId === "kurla").length;

    console.log(
        `Loaded ${drivers.length} drivers into simulator (${vashiCount} Vashi, ${kurlaCount} Kurla)`
    );

    // Push initial locations into Location Service.
    await Promise.all(drivers.map(updateLocationService));
    console.log("Initial driver locations pushed to Location Service");

    setInterval(async () => {
        try {
            const activeRideTargetsByDriverId = await getActiveRideTargetsByDriverId();

            drivers = drivers.map((driver) => {
                const target = activeRideTargetsByDriverId.get(driver.driverId);

                if (target) {
                    return moveDriverTowardTarget(driver, target);
                }

                return moveDriver(driver);
            });

            await Promise.all(drivers.map(updateLocationService));

            const sample = drivers[0];

            console.log(
                `Moved ${drivers.length} drivers. Sample ${sample.driverId}: ${sample.lat.toFixed(
                    5
                )}, ${sample.lng.toFixed(5)}`
            );
        } catch (err) {
            console.error("Simulator tick failed:", err);
        }
    }, SIMULATOR_INTERVAL_MS);
};

startSimulator().catch((err) => {
    console.error("Driver simulator failed:", err);
    process.exit(1);
});
