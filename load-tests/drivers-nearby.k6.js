import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

export const options = {
    scenarios: {
        nearby_reads: {
            executor: "constant-arrival-rate",
            rate: 50,
            timeUnit: "1s",
            duration: "1m",
            preAllocatedVUs: 20,
            maxVUs: 100,
        },
    },
    thresholds: {
        http_req_failed: ["rate<0.01"],
        http_req_duration: ["p(95)<500"],
    },
};

const BASE_URL = __ENV.BASE_URL || "http://nginx:8080";

const nearbyOk = new Counter("nearby_ok");
const nearbyEmpty = new Counter("nearby_empty");

export default function () {
    const res = http.get(`${BASE_URL}/drivers/nearby?lat=19.07&lng=73&ring=2`);

    const ok = check(res, {
        "GET /drivers/nearby returned 200": (r) => r.status === 200,
        "response is array": (r) => Array.isArray(r.json()),
    });

    if (ok) {
        nearbyOk.add(1);

        const drivers = res.json();

        if (drivers.length === 0) {
            nearbyEmpty.add(1);
        }
    }

    sleep(0.1);
}
