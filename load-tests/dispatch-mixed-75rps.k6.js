// Simulates mixed dispatch traffic at 75 RPS:
// ~90% GET /drivers/nearby and ~10% POST /rides.

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

export const options = {
    scenarios: {
        mixed_dispatch_75rps: {
            executor: "constant-arrival-rate",
            rate: 75,
            timeUnit: "1s",
            duration: "1m",
            preAllocatedVUs: 45,
            maxVUs: 140,
        },
    },
    thresholds: {
        http_req_failed: ["rate<0.02"],
        "http_req_duration{endpoint:nearby_drivers}": ["p(95)<500"],
        "http_req_duration{endpoint:ride_create}": ["p(95)<1000"],
    },
};

const BASE_URL = __ENV.BASE_URL || "http://nginx:8080";

const nearbyReads = new Counter("nearby_reads");
const rideCreates = new Counter("ride_creates");

export default function () {
    const shouldCreateRide = Math.random() < 0.1;

    if (shouldCreateRide) {
        const payload = JSON.stringify({
            pickup: { lat: 19.07, lng: 73 },
            dropoff: { lat: 19.078, lng: 73.01 },
            query: "",
            matchingMode: "standard",
        });

        const res = http.post(`${BASE_URL}/rides`, payload, {
            headers: { "Content-Type": "application/json" },
            tags: { endpoint: "ride_create" },
        });

        if (res.status !== 201) {
            console.log(`ride_create_failed status=${res.status}`);
        }

        check(res, {
            "POST /rides returned 201": (r) => r.status === 201,
        });

        rideCreates.add(1);
    } else {
        const res = http.get(`${BASE_URL}/drivers/nearby?lat=19.07&lng=73&ring=2`, {
            tags: { endpoint: "nearby_drivers" },
        });

        if (res.status !== 200) {
            console.log(`nearby_failed status=${res.status}`);
        }

        check(res, {
            "GET /drivers/nearby returned 200": (r) => r.status === 200,
        });

        nearbyReads.add(1);
    }

    sleep(0.05);
}
