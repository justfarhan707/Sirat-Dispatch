export type LiveDriverLocation = {
    driverId: string;
    lat: number;
    lng: number;
    h3Index: string;
    isAvailable: boolean;
    updatedAt: string;
};

const LOCATION_SERVICE_URL =
    process.env.LOCATION_SERVICE_URL || "http://localhost:4001";

export const findNearbyLiveDrivers = async (
    lat: number,
    lng: number,
    ringSize: number
): Promise<LiveDriverLocation[]> => {
    const url = new URL(`${LOCATION_SERVICE_URL}/drivers/nearby`);

    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lng", String(lng));
    url.searchParams.set("ring", String(ringSize));

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error("Failed to fetch nearby live drivers from Location Service");
    }

    return response.json() as Promise<LiveDriverLocation[]>;
};


//to send isAvailable to redis

export const updateLiveDriverAvailability = async (
    driverId: string,
    isAvailable: boolean
): Promise<LiveDriverLocation | null> => {
    const response = await fetch(
        `${LOCATION_SERVICE_URL}/drivers/${driverId}/availability`,
        {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ isAvailable }),
        }
    );

    if (response.status === 404) {
        return null;
    }

    if (!response.ok) {
        throw new Error("Failed to update live driver availability");
    }

    return response.json() as Promise<LiveDriverLocation>;
};
