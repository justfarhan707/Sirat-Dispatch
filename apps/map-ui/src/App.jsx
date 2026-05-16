import { useEffect, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer } from "react-leaflet";
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

function getDispatchFailureMessage(reason) {
  if (reason === "no_nearby_drivers") {
    return "No nearby drivers are online right now. Try standard matching or start the simulator.";
  }

  if (reason === "no_driver_embeddings") {
    return "Intelligent matching is not ready for nearby drivers yet. Generate embeddings or try standard matching.";
  }

  if (reason === "below_similarity_threshold") {
    return "No strong intelligent match found. Try a broader query or switch to standard matching.";
  }

  if (reason === "unsupported_sensitive_attribute") {
    return "We cannot match drivers by personal identity traits. Try language, vehicle type, pet-friendly, airport trips, or standard matching.";
  }

  if (reason === "max_dispatch_attempts_reached") {
    return "No driver accepted this request. Try again or switch matching style.";
  }

  return "No driver found. Try again or use standard matching.";
}

function getAssignedDriverFromRide(ride) {
  if (!ride?.assignedDriver || typeof ride.assignedDriver === "string") {
    return null;
  }

  return ride.assignedDriver;
}

function getDriverMapPosition(driver) {
  if (driver?.liveLocation?.lat && driver?.liveLocation?.lng) {
    return [driver.liveLocation.lat, driver.liveLocation.lng];
  }

  const coordinates = driver?.location?.coordinates;

  if (Array.isArray(coordinates) && coordinates.length >= 2) {
    const [lng, lat] = coordinates;
    return [lat, lng];
  }

  return null;
}

function getDispatchEventTitle(eventName) {
  const eventTitles = {
    ride_created: "Ride created",
    semantic_match_failed: "Semantic match failed",
    no_candidates_found: "No candidates found",
    driver_claim_failed: "Driver claim failed",
    driver_claimed: "Driver claimed",
    ride_assigned: "Ride assigned",
    ride_accepted: "Ride accepted",
    driver_timed_out: "Driver timed out",
    driver_rejected: "Driver rejected",
    ride_no_driver_found: "No driver found",
    ride_reassigned: "Ride reassigned",
    ride_back_to_searching: "Ride back to searching",
    ride_completed: "Ride completed",
    ride_cancelled: "Ride cancelled",
  };

  return eventTitles[eventName] || eventName;
}

function getDispatchEventTone(eventName) {
  if (
    [
      "semantic_match_failed",
      "no_candidates_found",
      "driver_claim_failed",
      "driver_timed_out",
      "driver_rejected",
      "ride_no_driver_found",
      "ride_cancelled",
    ].includes(eventName)
  ) {
    return "warn";
  }

  if (
    [
      "driver_claimed",
      "ride_assigned",
      "ride_accepted",
      "ride_reassigned",
      "ride_completed",
    ].includes(eventName)
  ) {
    return "good";
  }

  return "active";
}

function getDispatchEventSummary(event) {
  if (event.reason) {
    return `Reason: ${event.reason}`;
  }

  if (event.driverId) {
    return `Driver ${String(event.driverId).slice(-6)}`;
  }

  if (event.matchingMode) {
    return `${event.matchingMode} matching`;
  }

  return "Dispatch lifecycle event";
}

function formatEventTime(timestamp) {
  if (!timestamp) {
    return "--";
  }

  return new Date(timestamp).toLocaleTimeString();
}

function App() {
  const appView =
    new URLSearchParams(window.location.search).get("view") === "driver"
      ? "driver"
      : "rider";
  const [activeTab, setActiveTab] = useState("ride");
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
  const [dispatchEvents, setDispatchEvents] = useState([]);
  const [driverRouteToPickup, setDriverRouteToPickup] = useState([]);
  const [animatedDriverPosition, setAnimatedDriverPosition] = useState(null);
  const driversRef = useRef([]);
  const subscribedH3Ref = useRef(new Set());
  const driverRouteKeyRef = useRef(null);


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
      setNotice(getDispatchFailureMessage(freshRide.dispatchFailureReason));
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

      const [lng, lat] = payload.location.coordinates;

      setAssignedDriver((currentAssignedDriver) => {
        if (
          !currentAssignedDriver ||
          String(currentAssignedDriver._id) !== String(payload.driverId)
        ) {
          return currentAssignedDriver;
        }

        return {
          ...currentAssignedDriver,
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

      const driverExists = driversRef.current.some(
        (driver) => String(driver._id) === String(payload.driverId)
      );

      if (!driverExists) {
        fetchDrivers();
        return;
      }

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

    socket.on("dispatch:event", (payload) => {
      setDispatchEvents((currentEvents) => {
        const eventKey = `${payload.timestamp}-${payload.event}-${payload.rideId || ""}-${payload.driverId || ""}`;

        if (currentEvents.some((event) => event.eventKey === eventKey)) {
          return currentEvents;
        }

        return [
          {
            ...payload,
            eventKey,
          },
          ...currentEvents,
        ].slice(0, 40);
      });
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("driver:locationUpdated");
      socket.off("dispatch:event");
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
    const hasAssignedTripFocus =
      Boolean(assignedDriver) && ["assigned", "ongoing"].includes(currentRide?.status);

    if (!hasAssignedTripFocus || !assignedDriver?._id) {
      return;
    }

    const driverId = String(assignedDriver._id);
    socket.emit("subscribe:driver", driverId);

    return () => {
      socket.emit("unsubscribe:driver", driverId);
    };
  }, [currentRide?.status, assignedDriver?._id]);

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
            ? getDispatchFailureMessage(data.ride.dispatchFailureReason)
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
            ? getDispatchFailureMessage(data.ride.dispatchFailureReason)
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
  const showAssignedTripFocus =
    Boolean(assignedDriver) && ["assigned", "ongoing"].includes(currentRide?.status);
  const assignedDriverPosition = getDriverMapPosition(assignedDriver);
  const pickupPosition = [pickup.lat, pickup.lng];
  const dropoffPosition = [dropoff.lat, dropoff.lng];
  const activeTripTarget = currentRide?.status === "ongoing" ? dropoff : pickup;
  const activeTripTargetPosition = [activeTripTarget.lat, activeTripTarget.lng];
  const activeTripStartPosition =
    currentRide?.status === "ongoing" ? pickupPosition : assignedDriverPosition;
  const assignedDriverMapPosition =
    animatedDriverPosition ||
    (currentRide?.status === "ongoing" ? pickupPosition : assignedDriverPosition);
  const visibleMapDrivers = showAssignedTripFocus ? [] : drivers;

  useEffect(() => {
    if (!showAssignedTripFocus || !activeTripStartPosition) {
      setDriverRouteToPickup([]);
      setAnimatedDriverPosition(null);
      driverRouteKeyRef.current = null;
      return;
    }

    const routeKey = [
      assignedDriver?._id,
      currentRide?.status,
      activeTripTarget.lat,
      activeTripTarget.lng,
    ].join(":");

    if (driverRouteKeyRef.current === routeKey) {
      return;
    }

    driverRouteKeyRef.current = routeKey;

    const [startLat, startLng] = activeTripStartPosition;
    const controller = new AbortController();

    const fetchDriverRoute = async () => {
      try {
        const routeUrl = new URL(
          `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${activeTripTarget.lng},${activeTripTarget.lat}`
        );

        routeUrl.searchParams.set("overview", "full");
        routeUrl.searchParams.set("geometries", "geojson");

        const res = await fetch(routeUrl, {
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error("OSRM route request failed");
        }

        const data = await res.json();
        const coordinates = data.routes?.[0]?.geometry?.coordinates || [];

        if (!coordinates.length) {
          throw new Error("OSRM route returned no coordinates");
        }

        setDriverRouteToPickup(
          coordinates.map(([lng, lat]) => [lat, lng])
        );
        setAnimatedDriverPosition(coordinates[0] ? [coordinates[0][1], coordinates[0][0]] : null);
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        console.error("Failed to fetch driver route:", error);
        setDriverRouteToPickup([activeTripStartPosition, activeTripTargetPosition]);
        setAnimatedDriverPosition(activeTripStartPosition);
      }
    };

    fetchDriverRoute();

    return () => {
      controller.abort();
    };
  }, [
    showAssignedTripFocus,
    assignedDriver?._id,
    currentRide?.status,
    activeTripTarget.lat,
    activeTripTarget.lng,
  ]);

  useEffect(() => {
    if (!showAssignedTripFocus || driverRouteToPickup.length < 2) {
      setAnimatedDriverPosition(null);
      return;
    }

    let cursor = 0;
    const routeStep = Math.max(1, Math.floor(driverRouteToPickup.length / 60));

    setAnimatedDriverPosition(driverRouteToPickup[0]);

    const intervalId = setInterval(() => {
      cursor = Math.min(cursor + routeStep, driverRouteToPickup.length - 1);
      setAnimatedDriverPosition(driverRouteToPickup[cursor]);

      if (cursor >= driverRouteToPickup.length - 1) {
        clearInterval(intervalId);
      }
    }, 700);

    return () => clearInterval(intervalId);
  }, [
    showAssignedTripFocus,
    assignedDriver?._id,
    currentRide?.status,
    activeTripTarget.lat,
    activeTripTarget.lng,
    driverRouteToPickup,
  ]);

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
            <button
              className={activeTab === "ride" ? "active" : ""}
              onClick={() => setActiveTab("ride")}
              type="button"
            >
              Ride
            </button>
            <button
              className={matchingMode === "semantic" && activeTab === "ride" ? "active" : ""}
              onClick={() => {
                setActiveTab("ride");
                setMatchingMode("semantic");
                setBookingPhase("route");
              }}
              type="button"
            >
              Intelligent Match
            </button>
            <button
              className={activeTab === "activity" ? "active" : ""}
              onClick={() => setActiveTab("activity")}
              type="button"
            >
              Activity
            </button>
          </nav>

          <div className={`ride-status-chip ${heroTone}`}>
            <span />
            {heroStatus}
          </div>
        </header>

        {activeTab === "activity" ? (
          <div className="activity-layout">
            <section className="activity-hero">
              <p className="eyebrow">Live dispatch stream</p>
              <h1>Activity timeline</h1>
              <p className="lede">
                Watch ride creation, driver claims, semantic misses, assignments, accepts,
                and completions arrive from the backend socket stream.
              </p>

              <div className="activity-metrics">
                <div>
                  <span>Total events</span>
                  <strong>{dispatchEvents.length}</strong>
                </div>
                <div>
                  <span>Latest event</span>
                  <strong>
                    {dispatchEvents[0]
                      ? getDispatchEventTitle(dispatchEvents[0].event)
                      : "Waiting"}
                  </strong>
                </div>
                <div>
                  <span>Socket</span>
                  <strong>{socket.connected ? "connected" : "connecting"}</strong>
                </div>
              </div>
            </section>

            <section className="activity-panel">
              <div className="section-heading">
                <span>Dispatch events</span>
                <strong>{dispatchEvents.length ? "live" : "waiting"}</strong>
              </div>

              {dispatchEvents.length === 0 ? (
                <div className="activity-empty">
                  <span />
                  <strong>No dispatch events yet</strong>
                  <p>Request a ride, reject one, or complete a trip to light up this timeline.</p>
                </div>
              ) : (
                <div className="activity-list">
                  {dispatchEvents.map((event) => (
                    <article
                      className={`activity-item ${getDispatchEventTone(event.event)}`}
                      key={event.eventKey}
                    >
                      <div className="activity-dot" />
                      <div>
                        <small>{formatEventTime(event.timestamp)}</small>
                        <strong>{getDispatchEventTitle(event.event)}</strong>
                        <p>{getDispatchEventSummary(event)}</p>

                        <div className="activity-tags">
                          {event.rideId && <span>ride {String(event.rideId).slice(-6)}</span>}
                          {event.driverId && <span>driver {String(event.driverId).slice(-6)}</span>}
                          {event.assignmentVersion && <span>v{event.assignmentVersion}</span>}
                          {event.eligibleDriverCount !== undefined && (
                            <span>{event.eligibleDriverCount} eligible</span>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : (
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
                  {currentRide?.status === "no_driver_found"
                    ? getDispatchFailureMessage(currentRide.dispatchFailureReason)
                    : "Request a ride and we will show the assigned driver here."}
                </p>
              )}

              {currentRide?.status === "no_driver_found" && (
                <p className="status-message warning">
                  {getDispatchFailureMessage(currentRide.dispatchFailureReason)}
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

              {showAssignedTripFocus && assignedDriverMapPosition && (
                <Polyline
                  positions={
                    driverRouteToPickup.length > 0
                      ? driverRouteToPickup
                      : [activeTripStartPosition || assignedDriverMapPosition, activeTripTargetPosition]
                  }
                  pathOptions={{
                    color: "#0c6b46",
                    weight: 6,
                    opacity: 0.9,
                  }}
                />
              )}

              {showAssignedTripFocus && (
                <Polyline
                  positions={[pickupPosition, dropoffPosition]}
                  pathOptions={{
                    color: "#1f76ff",
                    weight: 4,
                    opacity: 0.45,
                    dashArray: "8 10",
                  }}
                />
              )}

              <Marker position={pickupPosition} icon={pickupIcon}>
                <Popup>Pickup point</Popup>
              </Marker>

              <Marker position={dropoffPosition} icon={dropoffIcon}>
                <Popup>Dropoff point</Popup>
              </Marker>

              {showAssignedTripFocus && assignedDriverMapPosition && (
                <Marker
                  key={`assigned-${assignedDriver._id}`}
                  position={assignedDriverMapPosition}
                  icon={driverIcon}
                >
                  <Popup>
                    <strong>{assignedDriver.name}</strong>
                    <br />
                    {currentRide?.status === "ongoing"
                      ? "Heading to destination"
                      : "On the way to pickup"}
                    <br />
                    Vehicle: {assignedDriver.vehicle?.type}
                    <br />
                    Rating: {assignedDriver.rating?.toFixed(2)}
                  </Popup>
                </Marker>
              )}

              {visibleMapDrivers.map((driver) => {
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

            <div className={`map-floating-card ${showAssignedTripFocus ? "assigned" : ""}`}>
              <strong>
                {showAssignedTripFocus && assignedDriver
                  ? `${assignedDriver.name} is on the way`
                  : "From Vashi Plaza"}
              </strong>
              <span>
                {showAssignedTripFocus
                  ? "Driver en route to pickup"
                  : `${selectedOption?.eta} pickup estimate`}
              </span>
            </div>
          </section>

          <div className="notice-row">
            <span>{lastUpdated || "--"}</span>
            <p>{notice}</p>
          </div>
        </div>
        )}
      </section>
    </main>
  );
}

export default App;
