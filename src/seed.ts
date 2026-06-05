import dns from "dns";

dns.setServers(["8.8.8.8", "8.8.4.4"]);
dns.setDefaultResultOrder("ipv4first");

import mongoose from "mongoose";
import dotenv from "dotenv";
import Driver from "./models/driver.model";
import Ride from "./models/ride.model";
import { H3Service } from "./services/h3.service";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI as string;

const DRIVER_COUNT_PER_ZONE = 100;

const ZONES = [
  {
    id: "vashi",
    label: "Vashi",
    bounds: {
      minLat: 19.055,
      maxLat: 19.085,
      minLng: 72.985,
      maxLng: 73.015,
    },
  },
  {
    id: "kurla",
    label: "Kurla",
    bounds: {
      minLat: 19.055,
      maxLat: 19.085,
      minLng: 72.87,
      maxLng: 72.9,
    },
  },
];

const getRandomLocation = (bounds: typeof ZONES[number]["bounds"]) => {
  const lat = bounds.minLat + Math.random() * (bounds.maxLat - bounds.minLat);
  const lng = bounds.minLng + Math.random() * (bounds.maxLng - bounds.minLng);
  return { lat, lng };
};

const getRandomItem = <T>(items: T[]): T => {
  return items[Math.floor(Math.random() * items.length)];
};

const seedDrivers = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("DB connected for seeding");

    await Driver.deleteMany({});
    await Ride.deleteMany({});

    console.log("Cleared old drivers and rides");

    const drivers: any[] = [];

    ZONES.forEach((zone, zoneIndex) => {
      for (let i = 0; i < DRIVER_COUNT_PER_ZONE; i++) {
        const driverNumber = zoneIndex * DRIVER_COUNT_PER_ZONE + i + 1;
        const { lat, lng } = getRandomLocation(zone.bounds);
        const h3Index = H3Service.getIndex(lat, lng);

        drivers.push({
          name: `${zone.label} Driver ${i + 1}`,
          phone: `99999${String(driverNumber).padStart(4, "0")}`,
          vehicle: {
            type: getRandomItem(["bike", "sedan", "suv"]),
            plateNumber: `MH01-${String(driverNumber).padStart(3, "0")}`,
          },
          location: {
            type: "Point",
            coordinates: [lng, lat],
          },
          h3Index,
          isAvailable: true,
          availabilityStatus: "available",
          currentRide: null,
          rating: Number((4 + Math.random()).toFixed(2)),
          petFriendly: Math.random() > 0.6,
          airportTripsCount: Math.floor(Math.random() * 200),
          languages: getRandomItem([
            ["English"],
            ["Hindi"],
            ["English", "Hindi"],
            ["Hindi", "Marathi"],
          ]),
          serviceTags: getRandomItem([
            ["quick-response"],
            ["pet-friendly"],
            ["airport-experienced"],
            ["quick-response", "airport-experienced"],
            ["pet-friendly", "city-rides"],
            ["airport-experienced", "long-distance"],
          ]),
          preferredRideTypes: getRandomItem([
            ["airport"],
            ["city-commute"],
            ["long-distance"],
            ["airport", "city-commute"],
          ]),
          profileText: "",
          embeddingStatus: "not_started",
          lastSeen: new Date(),
        });
      }
    });

    await Driver.insertMany(drivers);

    console.log(`Seeded ${drivers.length} drivers across Vashi and Kurla`);
    process.exit(0);
  } catch (err) {
    console.error("Seed failed:", err);
    process.exit(1);
  }
};

seedDrivers();
