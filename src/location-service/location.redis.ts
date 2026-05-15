import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

export const locationRedis = new Redis(redisUrl);

locationRedis.on("connect", () => {
    console.log("Location service redis connecyed");
});

locationRedis.on("error", (err) => {
    console.log("location redis error", err);
});


