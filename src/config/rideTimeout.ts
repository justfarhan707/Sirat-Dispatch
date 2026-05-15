const DRIVER_RESPONSE_TIMEOUT_MS = 30_000;
const MAX_DISPATCH_ATTEMPTS = 5;

export const getDriverResponseTimeoutMs = () => {
    return DRIVER_RESPONSE_TIMEOUT_MS;
};

export const getMaxDispatchAttempts = () => {
    return MAX_DISPATCH_ATTEMPTS;
};
