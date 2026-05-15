type DispatchLogPayload = Record<string, unknown>;

export const logDispatchEvent = (
    event: string,
    payload: DispatchLogPayload = {}
) => {
    console.log(
        "[dispatch]",
        JSON.stringify({
            event,
            timestamp: new Date().toISOString(),
            ...payload,
        })
    );
};
