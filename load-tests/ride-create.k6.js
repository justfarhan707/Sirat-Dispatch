import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

export const options = {
    scenarios: {
        ride_creates: {
            executor: "constant-arrival-rate",
            rate: 20,
            timeUnit: "1s",
            duration: "1m",
            preAllocatedVUs: 30,
            maxVUs: 100,
        },
    },
    thresholds: {
        http_req_failed: ["rate<0.05"],
        http_req_duration: ["p(95)<1000"],
    },
};

const BASE_URL = __ENV.BASE_URL || "http://nginx:8080";

const rideCreated = new Counter("ride_created");
const rideAssigned = new Counter("ride_assigned");
const rideSearching = new Counter("ride_searching");
const rideNoDriverFound = new Counter("ride_no_driver_found");

export default function () {
    const payload = JSON.stringify({
        pickup: {
            lat: 19.07,
            lng: 73,
        },
        dropoff: {
            lat: 19.078,
            lng: 73.01,
        },
        query: "",
        matchingMode: "standard",
    });

    const res = http.post(`${BASE_URL}/rides`, payload, {
        headers: {
            "Content-Type": "application/json",
        },
    });

    const ok = check(res, {
        "POST /rides returned 201": (r) => r.status === 201,
        "response has ride id": (r) => Boolean(r.json("ride._id")),
    });

    if (ok) {
        rideCreated.add(1);

        const status = res.json("ride.status");

        if (status === "assigned") {
            rideAssigned.add(1);
        }

        if (status === "searching") {
            rideSearching.add(1);
        }

        if (status === "no_driver_found") {
            rideNoDriverFound.add(1);
        }
    }

    sleep(0.2);
}
