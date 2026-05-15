import { useEffect, useRef, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { io } from "socket.io-client";
import L from "leaflet";
import "./App.css";

const CORE_API_URL = "/api";
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:3000";
const REFRESH_INTERVAL_MS = 15000;
const ACTIVE_RIDE_REFRESH_INTERVAL_MS = 1000;
const MAP_RING = 2;

const pickup = {
  lat: 19.07,
  lng: 73.0,
};

const dropoff = {
  lat: 19.078,
  lng: 73.01,
};

const driverIcon = L.divIcon({
  className: "driver-marker",
  html: "<div class='driver-dot'><span></span></div>",
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

const pickupIcon = L.divIcon({
  className: "trip-marker pickup-marker",
  html: "<div>P</div>",
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

const dropoffIcon = L.divIcon({
  className: "trip-marker dropoff-marker",
  html: "<div>D</div>",
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

const socket = io(SOCKET_URL, {
  autoConnect: false,
  transports: ["websocket"],
});


function getRideLabel(ride) {
  if (!ride) {
    return "No active request";
  }

  if (ride.status === "assigned") {
    return "Driver assigned";
  }

  if (ride.status === "ongoing") {
    return "Ride ongoing";
  }

  if (ride.status === "searching") {
    return "Searching for supply";
  }

  if (ride.status === "no_driver_found") {
    return "No driver found";
  }

  if (ride.status === "cancelled") {
    return "Ride cancelled";
  }

  if (ride.status === "completed") {
    return "Ride completed";
  }

  return ride.status;
}

function getAssignedDriverFromRide(ride) {
  if (!ride?.assignedDriver || typeof ride.assignedDriver === "string") {
    return null;
  }

  return ride.assignedDriver;
}

function App() {
  const [drivers, setDrivers] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [currentRide, setCurrentRide] = useState(null);
  const [assignedDriver, setAssignedDriver] = useState(null);
  const [matchingMode, setMatchingMode] = useState("standard");
  const [actionState, setActionState] = useState("idle");
  const [notice, setNotice] = useState("Live drivers are streaming from Redis.");
  const [now, setNow] = useState(Date.now());
  const [areaH3Indexes, setAreaH3Indexes] = useState([]);
  const driversRef = useRef([]);
  const subscribedH3Ref = useRef(new Set());


  const fetchAreaH3Indexes = async () => {
    try {
      const res = await fetch(
        `${CORE_API_URL}/geo/h3-neighbors?lat=${pickup.lat}&lng=${pickup.lng}&ring=${MAP_RING}`
      );

      if (!res.ok) {
        throw new Error("H3 area request failed");
      }

      const data = await res.json();
      const indexes = data.indexes || [];

      setAreaH3Indexes(indexes);

      return indexes;
    } catch (error) {
      console.error("Failed to fetch area H3 indexes:", error);
      setNotice("Could not subscribe to live map area.");

      return [];
    }
  };



  const fetchDrivers = async () => {
    try {
      const res = await fetch(
        `${CORE_API_URL}/drivers/nearby?lat=${pickup.lat}&lng=${pickup.lng}&ring=${MAP_RING}`
      );

      if (!res.ok) {
        throw new Error("Nearby request failed");
      }

      const data = await res.json();

      driversRef.current = data;
      setDrivers(data);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (error) {
      console.error("Failed to fetch drivers:", error);
      setNotice("Could not refresh live drivers. Check Core API and Location Service.");
    }
  };


  useEffect(() => {
    let intervalId;
    let isActive = true;

    const startMapFlow = async () => {
      const indexes = await fetchAreaH3Indexes();

      if (!isActive) {
        return;
      }

      indexes.forEach((h3Index) => {
        if (subscribedH3Ref.current.has(h3Index)) {
          return;
        }

        subscribedH3Ref.current.add(h3Index);
        socket.emit("subscribe:h3", h3Index);
      });

      await fetchDrivers();

      if (isActive) {
        intervalId = setInterval(fetchDrivers, REFRESH_INTERVAL_MS);
      }
    };

    startMapFlow();

    return () => {
      isActive = false;

      subscribedH3Ref.current.forEach((h3Index) => {
        socket.emit("unsubscribe:h3", h3Index);
      });
      subscribedH3Ref.current.clear();

      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, []);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(intervalId);
  }, []);


  const fetchCurrentRide = async (rideId) => {
    const res = await fetch(`${CORE_API_URL}/rides/${rideId}`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || "Failed to fetch ride");
    }

    const freshRide = data.ride;
    const freshAssignedDriver = getAssignedDriverFromRide(freshRide);

    setCurrentRide(freshRide);
    setAssignedDriver(freshAssignedDriver);

    if (freshRide.status === "searching" && !freshRide.assignedDriver) {
      setNotice("Dispatch worker is searching for an available driver...");
    }

    if (freshRide.status === "assigned" && freshAssignedDriver) {
      setNotice(`${freshAssignedDriver.name} got assigned. Driver response timer is running.`);
    }

    if (freshRide.status === "no_driver_found") {
      setNotice("No driver accepted this request. Dispatch stopped after max attempts.");
    }

    return freshRide;
  };

  useEffect(() => {
    socket.connect();

    socket.on("connect", () => {
      console.log("Socket connected:", socket.id);
    });

    socket.on("disconnect", () => {
      console.log("Socket disconnected");
    });

    socket.on("driver:locationUpdated", (payload) => {
      console.log("Live socket driver update:", payload.driverId, payload.h3Index);

      const driverExists = driversRef.current.some(
        (driver) => String(driver._id) === String(payload.driverId)
      );

      if (!driverExists) {
        fetchDrivers();
        return;
      }

      const [lng, lat] = payload.location.coordinates;

      setDrivers((currentDrivers) => {
        const nextDrivers = currentDrivers.map((driver) => {
          if (String(driver._id) !== String(payload.driverId)) {
            return driver;
          }

          return {
            ...driver,
            liveLocation: {
              driverId: payload.driverId,
              lat,
              lng,
              h3Index: payload.h3Index,
              isAvailable: payload.isAvailable,
              updatedAt: payload.lastSeen,
            },
          };
        });

        driversRef.current = nextDrivers;
        return nextDrivers;
      });

    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("driver:locationUpdated");
      socket.disconnect();
    };
  }, []);


  useEffect(() => {
    if (!currentRide?._id) {
      return;
    }

    const activeStatuses = ["searching", "assigned"];
    const refreshInterval = activeStatuses.includes(currentRide.status)
      ? ACTIVE_RIDE_REFRESH_INTERVAL_MS
      : REFRESH_INTERVAL_MS;

    const intervalId = setInterval(async () => {
      try {
        const freshRide = await fetchCurrentRide(currentRide._id);

        if (freshRide.status !== "ongoing") {
          await fetchDrivers();
        }
      } catch (error) {
        console.error("Failed to refresh ride:", error);
        setNotice("Could not refresh ride status from Core API.");
      }
    }, refreshInterval);

    return () => clearInterval(intervalId);
  }, [currentRide?._id, currentRide?.status]);

  const createRide = async () => {
    setActionState("creating");
    setNotice("Creating ride request through Core API...");

    try {
      const res = await fetch(`${CORE_API_URL}/rides`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pickup,
          dropoff,
          query:
            matchingMode === "semantic"
              ? "I want a quick English speaking driver"
              : "",
          matchingMode,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Ride creation failed");
      }

      setCurrentRide(data.ride);
      setAssignedDriver(getAssignedDriverFromRide(data.ride));
      setNotice(
        data.dispatchQueued
          ? "Ride created. Dispatch worker is finding a driver..."
          : getAssignedDriverFromRide(data.ride)
            ? `${getAssignedDriverFromRide(data.ride).name} got assigned. Watch the map supply drop.`
          : data.ride.status === "no_driver_found"
            ? "No driver accepted this request. Dispatch stopped after max attempts."
            : "No driver was assigned yet. Ride is searching."
      );

      await fetchDrivers();
    } catch (error) {
      console.error("Failed to create ride:", error);
      setNotice(error.message);
    } finally {
      setActionState("idle");
    }
  };

  const acceptRide = async () => {
    if (!currentRide?._id) {
      return;
    }

    setActionState("accepting");
    setNotice("Driver is accepting the ride...");

    try {
      const res = await fetch(`${CORE_API_URL}/rides/${currentRide._id}/accept`, {
        method: "PATCH",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Ride accept failed");
      }

      setCurrentRide(data.ride);
      setNotice("Ride moved to ongoing. Dispatch lifecycle is live.");
      await fetchDrivers();
    } catch (error) {
      console.error("Failed to accept ride:", error);
      setNotice(error.message);
    } finally {
      setActionState("idle");
    }
  };

  const rejectRide = async () => {
    if (!currentRide?._id) {
      return;
    }

    setActionState("rejecting");
    setNotice("Driver rejected. Dispatch is trying reassignment...");

    try {
      const res = await fetch(`${CORE_API_URL}/rides/${currentRide._id}/reject`, {
        method: "PATCH",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Ride reject failed");
      }

      setCurrentRide(data.ride);
      setAssignedDriver(data.assignedDriver);
      setNotice(
        data.reassigned
          ? `${data.assignedDriver.name} got reassigned.`
          : data.ride.status === "no_driver_found"
            ? "No driver accepted this request. Dispatch stopped after max attempts."
            : "No replacement driver found. Ride moved back to searching."
      );

      await fetchDrivers();
    } catch (error) {
      console.error("Failed to reject ride:", error);
      setNotice(error.message);
    } finally {
      setActionState("idle");
    }
  };

  const completeRide = async () => {
    if (!currentRide?._id) {
      return;
    }

    setActionState("completing");
    setNotice("Completing the ride...");

    try {
      const res = await fetch(`${CORE_API_URL}/rides/${currentRide._id}/complete`, {
        method: "PATCH",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Ride complete failed");
      }

      setCurrentRide(data.ride);
      setAssignedDriver(null);
      setNotice("Ride completed. Driver is available again.");
      await fetchDrivers();
    } catch (error) {
      console.error("Failed to complete ride:", error);
      setNotice(error.message);
    } finally {
      setActionState("idle");
    }
  };

  const cancelRide = async () => {
    if (!currentRide?._id) {
      return;
    }

    setActionState("cancelling");
    setNotice("Cancelling the ride...");

    try {
      const res = await fetch(`${CORE_API_URL}/rides/${currentRide._id}/cancel`, {
        method: "PATCH",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Ride cancel failed");
      }

      setCurrentRide(data.ride);
      setAssignedDriver(null);
      setNotice("Ride cancelled. Any assigned driver is available again.");
      await fetchDrivers();
    } catch (error) {
      console.error("Failed to cancel ride:", error);
      setNotice(error.message);
    } finally {
      setActionState("idle");
    }
  };

  const canRespond = currentRide?.status === "assigned" && currentRide.assignedDriver;
  const canComplete = currentRide?.status === "ongoing";
  const canCancel =
    currentRide &&
    !["completed", "cancelled", "no_driver_found"].includes(currentRide.status);

  const secondsUntilTimeout =
    currentRide?.status === "assigned" && currentRide.assignmentExpiresAt
      ? Math.max(
        0,
        Math.ceil(
          (new Date(currentRide.assignmentExpiresAt).getTime() - now) / 1000
        )
      )
      : null;

  return (
    <main className="app-shell">
      <section className="map-panel">
        <MapContainer
          center={[pickup.lat, pickup.lng]}
          zoom={13}
          scrollWheelZoom
          className="map"
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <Marker position={[pickup.lat, pickup.lng]} icon={pickupIcon}>
            <Popup>Pickup point</Popup>
          </Marker>

          <Marker position={[dropoff.lat, dropoff.lng]} icon={dropoffIcon}>
            <Popup>Dropoff point</Popup>
          </Marker>

          {drivers.map((driver) => {
            const live = driver.liveLocation;

            if (!live) {
              return null;
            }

            return (
              <Marker
                key={driver._id}
                position={[live.lat, live.lng]}
                icon={driverIcon}
              >
                <Popup>
                  <strong>{driver.name}</strong>
                  <br />
                  Vehicle: {driver.vehicle?.type}
                  <br />
                  Rating: {driver.rating?.toFixed(2)}
                  <br />
                  Available: {String(live.isAvailable)}
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>

        <aside className="control-card">
          <div className="brand-row">
            <div className="brand-mark">S</div>
            <div>
              <p className="eyebrow">Sirat By Farhan Live Dispatch</p>
              <h1>Ride Control Tower</h1>
            </div>
          </div>

          <p className="lede">
            Watch live Navi Mumbai supply, create a ride, and push the driver
            response flow without opening Postman.
          </p>

          <div className="stats-grid">
            <div className="stat-card">
              <span>{drivers.length}</span>
              <small>available nearby</small>
            </div>

            <div className="stat-card">
              <span>{MAP_RING}</span>
              <small>H3 ring</small>
            </div>

            <div className="stat-card wide">
              <span>{lastUpdated || "--"}</span>
              <small>last refresh</small>
            </div>
          </div>

          <section className="dispatch-box">
            <div className="section-heading">
              <span>Ride Request</span>
              <strong>{getRideLabel(currentRide)}</strong>
            </div>

            {secondsUntilTimeout !== null && (
              <div className="timeout-pill">
                <span>Driver response timeout</span>
                <strong>{secondsUntilTimeout}s</strong>
              </div>
            )}

            <div className="mode-toggle">
              <button
                className={matchingMode === "standard" ? "active" : ""}
                onClick={() => setMatchingMode("standard")}
                type="button"
              >
                Standard
              </button>
              <button
                className={matchingMode === "semantic" ? "active" : ""}
                onClick={() => setMatchingMode("semantic")}
                type="button"
              >
                Semantic
              </button>
            </div>

            <div className="route-card">
              <div>
                <span>Pickup</span>
                <strong>{pickup.lat}, {pickup.lng}</strong>
              </div>
              <div>
                <span>Dropoff</span>
                <strong>{dropoff.lat}, {dropoff.lng}</strong>
              </div>
            </div>

            <button
              className="primary-action"
              disabled={actionState !== "idle"}
              onClick={createRide}
              type="button"
            >
              {actionState === "creating" ? "Creating ride..." : "Create Test Ride"}
            </button>
          </section>

          <section className="driver-box">
            <div className="section-heading">
              <span>Assigned Driver</span>
              <strong>{assignedDriver?.name || "None"}</strong>
            </div>

            {assignedDriver ? (
              <div className="driver-card">
                <div>
                  <span>Vehicle</span>
                  <strong>
                    {assignedDriver.vehicle?.type || "unknown"} /{" "}
                    {assignedDriver.vehicle?.plateNumber || "no plate"}
                  </strong>
                </div>
                <div>
                  <span>Rating</span>
                  <strong>{assignedDriver.rating?.toFixed(2) || "--"}</strong>
                </div>
                <div>
                  <span>Status</span>
                  <strong>{currentRide?.status || "--"}</strong>
                </div>
              </div>
            ) : (
              <p className="empty-state">
                Create a ride and Sirat will assign the best available driver.
              </p>
            )}

            <div className="response-actions">
              <button
                disabled={!canRespond || actionState !== "idle"}
                onClick={acceptRide}
                type="button"
              >
                Accept
              </button>
              <button
                disabled={!canRespond || actionState !== "idle"}
                onClick={rejectRide}
                type="button"
              >
                Reject
              </button>
              <button
                disabled={!canComplete || actionState !== "idle"}
                onClick={completeRide}
                type="button"
              >
                Complete
              </button>
              <button
                disabled={!canCancel || actionState !== "idle"}
                onClick={cancelRide}
                type="button"
              >
                Cancel
              </button>
            </div>
          </section>

          <p className="notice">{notice}</p>
        </aside>
      </section>
    </main>
  );
}

export default App;
