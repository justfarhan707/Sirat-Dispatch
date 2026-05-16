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
};

const LOCATION_SERVICE_URL =
    process.env.LOCATION_SERVICE_URL || "http://localhost:4001";

const SIMULATOR_INTERVAL_MS = 3000;
const MAX_DRIVERS = 100;
const RANDOM_STEP_SIZE = 0.002;
const TARGET_STEP_SIZE = 0.0014;
const TARGET_REACHED_DISTANCE = 0.00025;

// Navi Mumbai-ish movement bounds.
const BOUNDS = {
    minLat: 19.055,
    maxLat: 19.085,
    minLng: 72.985,
    maxLng: 73.015,
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

const moveDriver = (driver: SimulatedDriver): SimulatedDriver => {
    const latStep = (Math.random() - 0.5) * RANDOM_STEP_SIZE;
    const lngStep = (Math.random() - 0.5) * RANDOM_STEP_SIZE;

    return {
        ...driver,
        lat: clamp(driver.lat + latStep, BOUNDS.minLat, BOUNDS.maxLat),
        lng: clamp(driver.lng + lngStep, BOUNDS.minLng, BOUNDS.maxLng),
    };
};

const moveDriverTowardTarget = (
    driver: SimulatedDriver,
    target: { lat: number; lng: number }
): SimulatedDriver => {
    const distance = getDistance(driver, target);

    if (distance <= TARGET_REACHED_DISTANCE) {
        return {
            ...driver,
            lat: target.lat,
            lng: target.lng,
        };
    }

    const progress = Math.min(TARGET_STEP_SIZE / distance, 1);
    const latJitter = (Math.random() - 0.5) * 0.00018;
    const lngJitter = (Math.random() - 0.5) * 0.00018;

    return {
        ...driver,
        lat: clamp(
            driver.lat + (target.lat - driver.lat) * progress + latJitter,
            BOUNDS.minLat,
            BOUNDS.maxLat
        ),
        lng: clamp(
            driver.lng + (target.lng - driver.lng) * progress + lngJitter,
            BOUNDS.minLng,
            BOUNDS.maxLng
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
        .limit(MAX_DRIVERS)
        .lean();

    return drivers.map((driver: any) => {
        const [lng, lat] = driver.location.coordinates;

        return {
            driverId: String(driver._id),
            lat,
            lng,
            isAvailable: driver.isAvailable,
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

    console.log(`Loaded ${drivers.length} drivers into simulator`);

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
