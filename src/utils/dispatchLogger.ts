import { publishDispatchEvent } from "../pubsub/dispatchEvent.pubsub";

type DispatchLogPayload = Record<string, unknown>;

export const logDispatchEvent = (
    event: string,
    payload: DispatchLogPayload = {}
) => {
    const dispatchEvent = {
        event,
        timestamp: new Date().toISOString(),
        ...payload,
    };

    console.log("[dispatch]", JSON.stringify(dispatchEvent));

    publishDispatchEvent(dispatchEvent).catch((err) => {
        console.error("Failed to publish dispatch event:", err);
    });
};