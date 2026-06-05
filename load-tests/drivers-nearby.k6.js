import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

export const options = {
    scenarios: {
        nearby_reads: {
            executor: "constant-arrival-rate",
            rate: 100,
            timeUnit: "1s",
            duration: "1m",
            preAllocatedVUs: 60,
            maxVUs: 180,
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

    const isJson = String(res.headers["Content-Type"] || "").includes("application/json");
    let drivers = null;

    if (res.status === 200 && isJson) {
        try {
            drivers = res.json();
        } catch (error) {
            console.log(`nearby_json_parse_failed status=${res.status} body=${String(res.body).slice(0, 120)}`);
        }
    } else {
        console.log(`nearby_bad_response status=${res.status} content_type=${res.headers["Content-Type"] || "unknown"} body=${String(res.body).slice(0, 120)}`);
    }

    const ok = check(res, {
        "GET /drivers/nearby returned 200": (r) => r.status === 200,
        "response is array": () => Array.isArray(drivers),
    });

    if (ok) {
        nearbyOk.add(1);

        if (drivers.length === 0) {
            nearbyEmpty.add(1);
        }
    }

    sleep(0.1);
}
