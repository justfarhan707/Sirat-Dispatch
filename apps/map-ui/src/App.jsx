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
const DEFAULT_SEMANTIC_QUERY = "I want a quick English speaking driver";

const pickup = {
  lat: 19.07,
  lng: 73.0,
};

const dropoff = {
  lat: 19.078,
  lng: 73.01,
};

const rideOptions = [
  {
    id: "bike",
    label: "Bike",
    description: "Zip through traffic",
    eta: "1 min",
    price: "₹82",
    icon: "B",
  },
  {
    id: "mini",
    label: "Mini",
    description: "Compact everyday ride",
    eta: "3 min",
    price: "₹219",
    icon: "M",
  },
  {
    id: "sedan",
    label: "Prime Sedan",
    description: "Top rated comfortable cars",
    eta: "4 min",
    price: "₹289",
    icon: "S",
  },
  {
    id: "suv",
    label: "Prime SUV",
    description: "More room for people and bags",
    eta: "6 min",
    price: "₹392",
    icon: "X",
  },
];

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
    return "Finding your driver";
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

function getRideTone(ride) {
  if (!ride) {
    return "idle";
  }

  if (["assigned", "ongoing", "completed"].includes(ride.status)) {
    return "good";
  }

  if (["no_driver_found", "cancelled"].includes(ride.status)) {
    return "warn";
  }

  return "active";
}

function getAssignedDriverFromRide(ride) {
  if (!ride?.assignedDriver || typeof ride.assignedDriver === "string") {
    return null;
  }

  return ride.assignedDriver;
}

function App() {
  const appView =
    new URLSearchParams(window.location.search).get("view") === "driver"
      ? "driver"
      : "rider";
  const [drivers, setDrivers] = useState([]);
  const [driverDirectory, setDriverDirectory] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [currentRide, setCurrentRide] = useState(null);
  const [assignedDriver, setAssignedDriver] = useState(null);
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [matchingMode, setMatchingMode] = useState("standard");
  const [semanticQuery, setSemanticQuery] = useState(DEFAULT_SEMANTIC_QUERY);
  const [selectedRideOption, setSelectedRideOption] = useState("mini");
  const [bookingPhase, setBookingPhase] = useState("route");
  const [actionState, setActionState] = useState("idle");
  const [notice, setNotice] = useState("Choose a ride style and request a driver.");
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

  const fetchDriverDirectory = async () => {
    try {
      const res = await fetch(`${CORE_API_URL}/drivers`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Driver directory request failed");
      }

      const directory = data.drivers || [];

      setDriverDirectory(directory);

      if (directory.length === 0) {
        setNotice("Driver directory is empty. Seed drivers or check Mongo.");
      }
    } catch (error) {
      console.error("Failed to fetch driver directory:", error);

      setDriverDirectory((currentDirectory) => {
        if (currentDirectory.length > 0) {
          return currentDirectory;
        }

        return driversRef.current;
      });

      setNotice(
        driversRef.current.length > 0
          ? "Fixed driver directory failed, using live nearby drivers for now. Rebuild Docker for /drivers."
          : "Could not load fixed driver directory. Rebuild Docker and make sure Mongo has seeded drivers."
      );
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
    if (appView !== "driver") {
      return;
    }

    fetchDriverDirectory();
  }, [appView]);

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

  const fetchActiveRideForDriver = async (driverId) => {
    const res = await fetch(`${CORE_API_URL}/drivers/${driverId}/active-ride`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || "Failed to fetch driver offer");
    }

    const activeRide = data.ride;
    const activeAssignedDriver = getAssignedDriverFromRide(activeRide);

    setCurrentRide(activeRide);
    setAssignedDriver(activeAssignedDriver);

    if (activeRide?.status === "assigned") {
      setNotice("New ride offer received. Accept before the countdown ends.");
    } else if (activeRide?.status === "ongoing") {
      setNotice("Ride accepted. Complete it when the trip is done.");
    } else {
      setNotice("Waiting for the next dispatch offer...");
    }

    return activeRide;
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

  useEffect(() => {
    if (selectedDriverId || driverDirectory.length === 0) {
      return;
    }

    setSelectedDriverId(String(driverDirectory[0]._id));
  }, [driverDirectory, selectedDriverId]);

  useEffect(() => {
    if (appView !== "driver" || !selectedDriverId) {
      return;
    }

    let isActive = true;

    const refreshDriverOffer = async () => {
      try {
        if (isActive) {
          await fetchActiveRideForDriver(selectedDriverId);
        }
      } catch (error) {
        console.error("Failed to refresh driver offer:", error);
        setNotice("Could not refresh driver offers.");
      }
    };

    refreshDriverOffer();
    const intervalId = setInterval(refreshDriverOffer, ACTIVE_RIDE_REFRESH_INTERVAL_MS);

    return () => {
      isActive = false;
      clearInterval(intervalId);
    };
  }, [appView, selectedDriverId]);

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
              ? semanticQuery.trim() || DEFAULT_SEMANTIC_QUERY
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

  const assignedVehicle = assignedDriver?.vehicle?.type || "driver";
  const heroStatus = getRideLabel(currentRide);
  const heroTone = getRideTone(currentRide);
  const selectedOption = rideOptions.find((option) => option.id === selectedRideOption);
  const showRideChoices = bookingPhase === "rides";

  if (appView === "driver") {
    const selectedDriver = driverDirectory.find(
      (driver) => String(driver._id) === String(selectedDriverId)
    ) || assignedDriver;
    const driverOptions = [...driverDirectory];

    if (
      assignedDriver &&
      !driverOptions.some((driver) => String(driver._id) === String(assignedDriver._id))
    ) {
      driverOptions.unshift(assignedDriver);
    }

    return (
      <main className="driver-app-shell">
        <section className="driver-console">
          <header className="driver-console-nav">
            <div className="brand-lockup">
              <div className="brand-mark">S</div>
              <div>
                <p>Sirat Driver</p>
                <strong>Offer Console</strong>
              </div>
            </div>

            <a href="/" className="view-link">Rider view</a>
          </header>

          <div className="driver-console-grid">
            <aside className="driver-selector-card">
              <p className="eyebrow">Driver mode</p>
              <h1>Ready for offers?</h1>
              <p className="lede">
                Pick a live driver and watch assignments arrive from the dispatch worker.
              </p>

              <label className="driver-select">
                <span>Active driver</span>
                <select
                  value={selectedDriverId}
                  onChange={(event) => {
                    setSelectedDriverId(event.target.value);
                    setCurrentRide(null);
                    setAssignedDriver(null);
                  }}
                >
                  {driverOptions.map((driver) => (
                    <option key={driver._id} value={driver._id}>
                      {driver.name} · {driver.vehicle?.type || "vehicle"}
                    </option>
                  ))}
                </select>
              </label>

              {selectedDriver ? (
                <div className="driver-profile-card">
                  <div className="driver-avatar">
                    {selectedDriver.name?.charAt(0) || "D"}
                  </div>
                  <div>
                    <small>Signed in as</small>
                    <strong>{selectedDriver.name}</strong>
                    <p>
                      {selectedDriver.vehicle?.type || "vehicle"} ·{" "}
                      {selectedDriver.rating?.toFixed(2) || "--"} rating
                    </p>
                  </div>
                </div>
              ) : (
                <p className="empty-state">Start the simulator to load live drivers.</p>
              )}

              <div className="notice-row">
                <span>{lastUpdated || "--"}</span>
                <p>{notice}</p>
              </div>
            </aside>

            <section className={`offer-card ${heroTone}`}>
              <div className="section-heading">
                <span>Incoming offer</span>
                <strong>{currentRide?.status || "waiting"}</strong>
              </div>

              {secondsUntilTimeout !== null && (
                <div className="driver-countdown">
                  <span>Respond in</span>
                  <strong>{secondsUntilTimeout}s</strong>
                </div>
              )}

              {currentRide ? (
                <>
                  <div className="offer-route">
                    <div>
                      <small>Pickup</small>
                      <strong>Vashi Plaza</strong>
                      <p>{currentRide.pickup?.lat}, {currentRide.pickup?.lng}</p>
                    </div>
                    <div>
                      <small>Dropoff</small>
                      <strong>Palm Beach Road</strong>
                      <p>{currentRide.dropoff?.lat}, {currentRide.dropoff?.lng}</p>
                    </div>
                  </div>

                  <div className="response-actions driver-actions">
                    <button
                      disabled={!canRespond || actionState !== "idle"}
                      onClick={acceptRide}
                      type="button"
                    >
                      Accept offer
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
                      Complete ride
                    </button>
                  </div>
                </>
              ) : (
                <div className="waiting-offer">
                  <span />
                  <strong>Waiting for dispatch</strong>
                  <p>Request a ride from the rider view and this driver will receive it here if assigned.</p>
                </div>
              )}
            </section>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="ride-app">
        <header className="app-nav">
          <div className="brand-lockup">
            <div className="brand-mark">S</div>
            <div>
              <p>Sirat</p>
              <strong>Dispatch</strong>
            </div>
          </div>

          <nav className="nav-tabs" aria-label="Sirat sections">
            <button className="active" type="button">Ride</button>
            <button type="button">Intelligent Match</button>
            <button type="button">Activity</button>
          </nav>

          <div className={`ride-status-chip ${heroTone}`}>
            <span />
            {heroStatus}
          </div>
        </header>

        <div className={`booking-layout ${showRideChoices ? "rides-phase" : "route-phase"}`}>
          <aside className="booking-panel">
            <section className="request-card">
              <p className="eyebrow">Get a ride</p>
              <h1>{showRideChoices ? "Choose your Sirat ride" : "Plan your route"}</h1>
              <p className="lede">
                {showRideChoices
                  ? "Pick a ride type and request a driver from the live dispatch pool."
                  : "Choose a matching style, confirm the route, then browse available rides."}
              </p>

              <div className="route-stack" aria-label="Route">
                <div className="route-line">
                  <span className="route-dot pickup-dot" />
                  <div>
                    <small>From</small>
                    <strong>Vashi Plaza</strong>
                    <p>{pickup.lat}, {pickup.lng}</p>
                  </div>
                </div>

                <div className="route-line">
                  <span className="route-dot dropoff-dot" />
                  <div>
                    <small>To</small>
                    <strong>Palm Beach Road</strong>
                    <p>{dropoff.lat}, {dropoff.lng}</p>
                  </div>
                </div>

                <div className="route-line muted-line">
                  <span className="route-dot time-dot" />
                  <div>
                    <small>When</small>
                    <select aria-label="Pickup time" defaultValue="now">
                      <option value="now">Pickup now</option>
                      <option value="10">In 10 minutes</option>
                      <option value="20">In 20 minutes</option>
                    </select>
                    <p>Live dispatch, no scheduling delay</p>
                  </div>
                </div>
              </div>
            </section>

            <section className="ride-mode-card">
              <div className="section-heading">
                <span>Matching style</span>
                <strong>{drivers.length} drivers nearby</strong>
              </div>

              <div className="mode-toggle">
                <button
                  className={matchingMode === "standard" ? "active" : ""}
                  onClick={() => setMatchingMode("standard")}
                  type="button"
                >
                  <span>Standard</span>
                  <small>Nearest available driver</small>
                </button>
                <button
                  className={matchingMode === "semantic" ? "active" : ""}
                  onClick={() => setMatchingMode("semantic")}
                  type="button"
                >
                  <span>Intelligent</span>
                  <small>Match by natural language</small>
                </button>
              </div>

              {matchingMode === "semantic" && (
                <label className="ai-query-box">
                  <span>Describe your ideal driver</span>
                  <textarea
                    value={semanticQuery}
                    onChange={(event) => setSemanticQuery(event.target.value)}
                    rows={3}
                    placeholder="Pet friendly, Hindi speaking, airport friendly..."
                  />
                </label>
              )}
            </section>

            {!showRideChoices && (
              <button
                className="primary-action look-rides-action"
                onClick={() => setBookingPhase("rides")}
                type="button"
              >
                Look for rides
              </button>
            )}

            {showRideChoices && (
              <button
                className="secondary-action"
                onClick={() => setBookingPhase("route")}
                type="button"
              >
                Edit route
              </button>
            )}
          </aside>

          {showRideChoices && (
          <section className="ride-results">
            <section className="available-rides results-rides">
              <div className="section-heading">
                <span>Available rides</span>
                <strong>{selectedOption?.label}</strong>
              </div>

              <div className="ride-option-list">
                {rideOptions.map((option) => (
                  <button
                    className={selectedRideOption === option.id ? "selected" : ""}
                    key={option.id}
                    onClick={() => setSelectedRideOption(option.id)}
                    type="button"
                  >
                    <div className="vehicle-icon">{option.icon}</div>
                    <div>
                      <strong>{option.label}</strong>
                      <p>{option.description}</p>
                      <small>{option.eta} away</small>
                    </div>
                    <span>{option.price}</span>
                  </button>
                ))}
              </div>
              <button
                className="primary-action"
                disabled={actionState !== "idle"}
                onClick={createRide}
                type="button"
              >
                {actionState === "creating"
                  ? "Requesting..."
                  : `Request ${selectedOption?.label}`}
              </button>
            </section>

            <section className={`trip-card ${heroTone}`}>
              <div className="section-heading">
                <span>Trip status</span>
                <strong>{currentRide?.status || "ready"}</strong>
              </div>

              {secondsUntilTimeout !== null && (
                <div className="timeout-pill">
                  <span>Offer expires in</span>
                  <strong>{secondsUntilTimeout}s</strong>
                </div>
              )}

              {assignedDriver ? (
                <div className="assigned-driver-card">
                  <div className="driver-avatar">
                    {assignedDriver.name?.charAt(0) || "D"}
                  </div>
                  <div>
                    <small>Your {assignedVehicle}</small>
                    <strong>{assignedDriver.name}</strong>
                    <p>
                      {assignedDriver.vehicle?.plateNumber || "Plate pending"} ·{" "}
                      {assignedDriver.rating?.toFixed(2) || "--"} rating
                    </p>
                  </div>
                </div>
              ) : (
                <p className="empty-state">
                  Request a ride and we will show the assigned driver here.
                </p>
              )}

            </section>
          </section>
          )}

          <section className="map-card">
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

            <div className="map-floating-card">
              <strong>From Vashi Plaza</strong>
              <span>{selectedOption?.eta} pickup estimate</span>
            </div>
          </section>

          <div className="notice-row">
            <span>{lastUpdated || "--"}</span>
            <p>{notice}</p>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
