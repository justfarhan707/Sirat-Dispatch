const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const parsedUrl = new URL(redisUrl);

export const bullConnection = {
    host: parsedUrl.hostname,
    port: Number(parsedUrl.port || 6379),
    userName: parsedUrl.username || undefined,
    password: parsedUrl.password || undefined,
    db: parsedUrl.pathname ? Number(parsedUrl.pathname.slice(1) || 0) : 0,
    maxRetriesPerRequest: null as null, // Important for BullMQ to prevent connection issues

}