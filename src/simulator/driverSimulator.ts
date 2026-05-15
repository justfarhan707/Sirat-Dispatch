import dotenv from "dotenv";
import mongoose from "mongoose";
import dns from "dns";
import Driver from "../models/driver.model";

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

const moveDriver = (driver: SimulatedDriver): SimulatedDriver => {
    const latStep = (Math.random() - 0.5) * 0.002;
    const lngStep = (Math.random() - 0.5) * 0.002;

    return {
        ...driver,
        lat: clamp(driver.lat + latStep, BOUNDS.minLat, BOUNDS.maxLat),
        lng: clamp(driver.lng + lngStep, BOUNDS.minLng, BOUNDS.maxLng),
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
    const drivers = await Driver.find({
        isAvailable: true,
        availabilityStatus: "available",
        currentRide: null,
    })

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
            drivers = drivers.map(moveDriver);

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
