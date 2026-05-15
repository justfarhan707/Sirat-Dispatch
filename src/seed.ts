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

// Tight Vashi hot-zone bounds for dense demo traffic.
const VASHI_MIN_LAT = 19.055;
const VASHI_MAX_LAT = 19.085;
const VASHI_MIN_LNG = 72.985;
const VASHI_MAX_LNG = 73.015;

const getRandomLocation = () => {
  const lat = VASHI_MIN_LAT + Math.random() * (VASHI_MAX_LAT - VASHI_MIN_LAT);
  const lng = VASHI_MIN_LNG + Math.random() * (VASHI_MAX_LNG - VASHI_MIN_LNG);
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

    const drivers = [];

    for (let i = 0; i < 100; i++) {
      const { lat, lng } = getRandomLocation();
      const h3Index = H3Service.getIndex(lat, lng);

      drivers.push({
        name: `Driver ${i + 1}`,
        phone: `99999${String(i + 1).padStart(4, "0")}`,
        vehicle: {
          type: getRandomItem(["bike", "sedan", "suv"]),
          plateNumber: `MH01-${String(i + 1).padStart(3, "0")}`,
        },
        location: {
          type: "Point",
          coordinates: [lng, lat],
        },
        h3Index,
        isAvailable: true,
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

    await Driver.insertMany(drivers);

    console.log("Seeded 100 Vashi-zone drivers");
    process.exit(0);
  } catch (err) {
    console.error("Seed failed:", err);
    process.exit(1);
  }
};

seedDrivers();
