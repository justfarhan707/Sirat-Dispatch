import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

export const redisPub = new Redis(redisUrl);
export const redisSub = new Redis(redisUrl);
export const redisCache = new Redis(redisUrl);

redisPub.on("connect", () => {
    console.log("Redis publisher connected");
});

redisSub.on("connect", () => {
    console.log("Redis subscriber connected");
});

redisPub.on("error", (err) => {
    console.error("Redis publisher error:", err);
});

redisSub.on("error", (err) => {
    console.error("Redis subscriber error:", err);
});

redisCache.on("connect", () => {
    console.log("Redis cache connected");
});

redisCache.on("error", (err) => {
    console.error("Redis cache error:", err);
});

export const RIDE_RESPONSE_TIMEOUTS_KEY = "ride:response:timeouts";
