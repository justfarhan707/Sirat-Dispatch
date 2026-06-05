import { useEffect, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { io } from "socket.io-client";
import L from "leaflet";
import "./App.css";

const CORE_API_URL = "/api";
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:3000";
const REFRESH_INTERVAL_MS = 15000;
const ACTIVE_RIDE_REFRESH_INTERVAL_MS = 1000;
const MAP_RING = 2;
const DEFAULT_SEMANTIC_QUERY = "I want a quick English speaking driver";

const pickupOptions = [
  {
    id: "vashi",
    label: "Vashi Plaza",
    lat: 19.07,
    lng: 73.0,
    defaultDropoffId: "palm-beach",
  },
  {
    id: "kurla",
    label: "Kurla Station",
    lat: 19.0726,
    lng: 72.8845,
    defaultDropoffId: "bkc",
  },
];

const dropoffOptions = [
  {
    id: "palm-beach",
    label: "Palm Beach Road",
    lat: 19.078,
    lng: 73.01,
  },
  {
    id: "vashi-station",
    label: "Vashi Station",
    lat: 19.0635,
    lng: 72.9986,
  },
  {
    id: "bkc",
    label: "BKC Connector",
    lat: 19.0674,
    lng: 72.8692,
  },
  {
    id: "phoenix-marketcity",
    label: "Phoenix Marketcity",
    lat: 19.0863,
    lng: 72.8897,
  },
  {
    id: "kurla-west",
    label: "Kurla West",
    lat: 19.0698,
    lng: 72.8798,
  },
];

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

function getDriverZoneId(driver) {
  const name = String(driver?.name || "").toLowerCase();

  if (name.includes("kurla")) {
    return "kurla";
  }

  const coordinates = driver?.location?.coordinates;

  if (Array.isArray(coordinates) && coordinates.length >= 2) {
    const lng = Number(coordinates[0]);

    if (lng < 72.94) {
      return "kurla";
    }
  }

  return "vashi";
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

function countEvents(events, eventNames) {
  return events.filter((event) => eventNames.includes(event.event)).length;
}

function RecenterMap({ lat, lng }) {
  const map = useMap();

  useEffect(() => {
    map.flyTo([lat, lng], 13, {
      duration: 0.8,
    });
  }, [lat, lng, map]);

  return null;
}

function IntroPage() {
  const showLegacyIntro = window.location.search.includes("legacyIntro=1");

  if (!showLegacyIntro) {
    return <ShowcaseIntroPage />;
  }

  return (
    <main className="intro-shell">
      <section className="intro-hero">
        <div className="intro-map-scene" aria-hidden="true">
          <div className="intro-road intro-road-a" />
          <div className="intro-road intro-road-b" />
          <div className="intro-road intro-road-c" />
          <div className="intro-zone intro-zone-vashi">
            <span>Vashi</span>
          </div>
          <div className="intro-zone intro-zone-kurla">
            <span>Kurla</span>
          </div>
          <div className="intro-car intro-car-a" />
          <div className="intro-car intro-car-b" />
          <div className="intro-car intro-car-c" />
          <div className="intro-pickup-pin">P</div>
          <div className="intro-dispatch-line" />
          <div className="intro-live-card intro-live-card-a">
            <span>Dispatch</span>
            <strong>Driver matched</strong>
            <small>semantic + nearest pool</small>
          </div>
          <div className="intro-live-card intro-live-card-b">
            <span>ETA</span>
            <strong>3 min</strong>
            <small>Vashi Plaza pickup</small>
          </div>
          <div className="intro-route-card">
            <div>
              <span className="route-dot pickup-dot" />
              <strong>Vashi Plaza</strong>
            </div>
            <div>
              <span className="route-dot dropoff-dot" />
              <strong>Palm Beach Road</strong>
            </div>
          </div>
        </div>

        <header className="intro-nav">
          <div className="brand-lockup">
            <div className="brand-mark">S</div>
            <div>
              <p>Sirat</p>
              <strong>Ride Dispatch</strong>
            </div>
          </div>

          <div className="intro-nav-actions">
            <a href="#features">Features</a>
            <a href="#system">System</a>
            <a href="/?view=driver">Driver console</a>
            <a className="intro-nav-cta" href="/?demo=1" target="_blank" rel="noreferrer">
              Launch app
            </a>
          </div>
        </header>

        <div className="intro-hero-content">
          <p className="eyebrow">Welcome to Sirat</p>
          <h1>Your ride marketplace, alive from request to arrival.</h1>
          <p>
            A polished rider app, driver console, and operator view wrapped around
            the same backend engine. Request a trip, match intelligently, watch the
            driver claim it, and see every dispatch signal move in real time.
          </p>

          <div className="intro-actions">
            <a className="intro-primary-action" href="/?demo=1" target="_blank" rel="noreferrer">
              Start rider flow
            </a>
            <a href="/?view=driver" className="intro-secondary-action">
              Open driver console
            </a>
          </div>

          <div className="intro-metrics" aria-label="Project highlights">
            <div>
              <strong>Live</strong>
              <span>socket-powered trip lifecycle</span>
            </div>
            <div>
              <strong>H3</strong>
              <span>nearby driver indexing</span>
            </div>
            <div>
              <strong>AI</strong>
              <span>natural-language driver matching</span>
            </div>
          </div>
        </div>
      </section>

      <section className="intro-section intro-about">
        <div>
          <p className="eyebrow">Built like one product</p>
          <h2>The frontend finally feels as capable as the backend.</h2>
        </div>
        <p>
          Sirat now opens with the same confidence as its engine: live supply,
          semantic dispatch, driver offers, timeout handling, and operator
          visibility are presented as one welcoming experience instead of a set of
          disconnected demo notes.
        </p>
      </section>

      <section className="intro-video-section" id="system">
        <div className="intro-video-copy">
          <p className="eyebrow">Dispatch twin</p>
          <h2>Every screen is connected to the backend story.</h2>
          <p>
            The first page mirrors the live system underneath it: rider intent,
            nearby supply, Redis-backed location lookup, driver claims, and ops
            events all show up as product moments the user can understand.
          </p>
        </div>
        <div className="intro-command-center">
          <div className="intro-command-header">
            <span>Live dispatch board</span>
            <strong>Request SR-042</strong>
          </div>
          <div className="intro-command-grid">
            <article>
              <small>Rider intent</small>
              <strong>English speaking driver</strong>
            </article>
            <article>
              <small>Supply zone</small>
              <strong>Vashi pool</strong>
            </article>
            <article>
              <small>Claim state</small>
              <strong>Accepted</strong>
            </article>
            <article>
              <small>Operator view</small>
              <strong>Healthy</strong>
            </article>
          </div>
        </div>
      </section>

      <section className="intro-feature-grid" id="features" aria-label="Sirat capabilities">
        <article>
          <span>01</span>
          <strong>Rider Booking</strong>
          <p>
            Select pickup and dropoff, browse ride categories, choose standard or
            intelligent matching, and request a driver from the live pool.
          </p>
        </article>
        <article>
          <span>02</span>
          <strong>Driver Offers</strong>
          <p>
            Drivers can receive assigned offers, accept, reject, complete rides,
            and move through realistic availability states.
          </p>
        </article>
        <article>
          <span>03</span>
          <strong>Live Supply Map</strong>
          <p>
            Vashi and Kurla driver pools move on the map so pickup changes feel
            like a real marketplace with live nearby supply.
          </p>
        </article>
        <article>
          <span>04</span>
          <strong>Ops Visibility</strong>
          <p>
            Socket events, driver states, ride status, warnings, and assignment
            lifecycle events are visible from the dashboard.
          </p>
        </article>
      </section>

      <section className="intro-product-grid" aria-label="Sirat product details">
        <article>
          <small>For riders</small>
          <strong>Fast trip planning</strong>
          <p>Route selection, ride cards, live pickup estimates, and assigned driver tracking.</p>
        </article>
        <article>
          <small>For drivers</small>
          <strong>Offer console</strong>
          <p>Separate Vashi/Kurla driver selection with offer actions and countdown behavior.</p>
        </article>
        <article>
          <small>For operators</small>
          <strong>Dispatch control room</strong>
          <p>Assignment events, warning queue, driver states, socket status, and ride lifecycle.</p>
        </article>
      </section>

      <section className="intro-system-strip" aria-label="Technology highlights">
        <div>
          <small>Frontend</small>
          <strong>React Map UI</strong>
        </div>
        <div>
          <small>Gateway</small>
          <strong>Nginx</strong>
        </div>
        <div>
          <small>API</small>
          <strong>Core API x2</strong>
        </div>
        <div>
          <small>Live state</small>
          <strong>Redis + H3</strong>
        </div>
        <div>
          <small>Storage</small>
          <strong>MongoDB</strong>
        </div>
        <div>
          <small>Workers</small>
          <strong>Dispatch + Timeout</strong>
        </div>
      </section>

      <footer className="intro-footer">
        <div>
          <div className="brand-lockup">
            <div className="brand-mark">S</div>
            <div>
              <p>Sirat</p>
              <strong>Real-time Ride Dispatch</strong>
            </div>
          </div>
          <p>
            A full-stack showcase project for live ride matching, driver movement,
            async dispatch, and operational visibility.
          </p>
        </div>
        <nav aria-label="Footer links">
          <a href="/?demo=1" target="_blank" rel="noreferrer">Try Sirat Web</a>
          <a href="/?view=driver">Driver Console</a>
          <a href="#features">Features</a>
          <a href="#demo-video">Demo Video</a>
          <span>Architecture page coming next</span>
        </nav>
      </footer>
    </main>
  );
}

function ShowcaseIntroPage() {
  return (
    <main className="intro-shell showcase-intro">
      <header className="intro-nav showcase-nav">
        <div className="brand-lockup">
          <div className="brand-mark">S</div>
          <div>
            <p>Sirat</p>
            <strong>Realtime Ride Dispatch</strong>
          </div>
        </div>

        <div className="intro-nav-actions">
          <a href="#architecture">Architecture</a>
          <a href="#capabilities">Capabilities</a>
          <a href="#resume">Resume proof</a>
          <a href="/?view=driver">Driver console</a>
          <a className="intro-nav-cta" href="/?demo=1" target="_blank" rel="noreferrer">
            Launch product
          </a>
        </div>
      </header>

      <section className="showcase-hero">
        <div className="showcase-hero-copy">
          <p className="eyebrow">Full-stack engineering showcase</p>
          <h1>Sirat turns ride dispatch into a live, resume-ready product.</h1>
          <p>
            A real-time ride marketplace with rider booking, driver offers, live
            location indexing, AI-assisted matching, asynchronous workers, and an
            operations console that exposes the entire dispatch lifecycle.
          </p>

          <div className="intro-actions">
            <a className="intro-primary-action" href="/?demo=1" target="_blank" rel="noreferrer">
              Explore rider app
            </a>
            <a href="/?view=driver" className="intro-secondary-action">
              Open driver console
            </a>
          </div>

          <dl className="showcase-scoreboard" aria-label="Sirat project highlights">
            <div>
              <dt>Realtime</dt>
              <dd>Socket.IO trip updates</dd>
            </div>
            <div>
              <dt>Geo</dt>
              <dd>Redis + H3 nearby search</dd>
            </div>
            <div>
              <dt>AI</dt>
              <dd>Natural-language matching</dd>
            </div>
          </dl>
        </div>

        <div className="showcase-stage" aria-label="Dispatch system preview">
          <div className="stage-map-grid" aria-hidden="true" />
          <div className="stage-road stage-road-a" />
          <div className="stage-road stage-road-b" />
          <div className="stage-road stage-road-c" />
          <div className="stage-zone stage-zone-vashi">Vashi supply</div>
          <div className="stage-zone stage-zone-kurla">Kurla supply</div>
          <div className="stage-driver driver-one"><span /></div>
          <div className="stage-driver driver-two"><span /></div>
          <div className="stage-driver driver-three"><span /></div>
          <div className="stage-pin">P</div>
          <div className="stage-route-pulse" />

          <div className="stage-phone">
            <div className="phone-topbar" />
            <div className="phone-route">
              <span className="route-dot pickup-dot" />
              <strong>Vashi Plaza</strong>
              <small>pickup now</small>
            </div>
            <div className="phone-route">
              <span className="route-dot dropoff-dot" />
              <strong>Palm Beach Road</strong>
              <small>7.8 km route</small>
            </div>
            <div className="phone-offer">
              <span>Prime Sedan</span>
              <strong>Driver found</strong>
            </div>
          </div>

          <div className="stage-dispatch-card">
            <small>Dispatch worker</small>
            <strong>Offer accepted</strong>
            <p>claim lock to ride assigned to socket broadcast</p>
          </div>

          <div className="stage-ops-card">
            <small>Ops health</small>
            <div><span /> API gateway</div>
            <div><span /> Redis index</div>
            <div><span /> Timeout worker</div>
          </div>
        </div>
      </section>

      <section className="showcase-proof-strip" id="resume" aria-label="Resume proof points">
        <article>
          <span>01</span>
          <strong>Marketplace simulation</strong>
          <p>Rider demand, moving drivers, assignments, rejections, timeouts, and completion states.</p>
        </article>
        <article>
          <span>02</span>
          <strong>Distributed backend</strong>
          <p>Express APIs, Socket.IO, Redis, MongoDB, BullMQ workers, and Nginx routing.</p>
        </article>
        <article>
          <span>03</span>
          <strong>Intelligent matching</strong>
          <p>Natural-language preferences routed through semantic driver profiles with fallback logic.</p>
        </article>
      </section>

      <section className="showcase-architecture" id="architecture">
        <div className="showcase-section-copy">
          <p className="eyebrow">System architecture</p>
          <h2>Designed to show backend depth, not just a pretty map.</h2>
          <p>
            The UI is the front door to a production-style dispatch system. Each
            ride request flows through live geo lookup, driver selection, offer
            locking, timeout recovery, and realtime status broadcasting.
          </p>
        </div>

        <div className="architecture-board">
          <article className="architecture-node node-rider">
            <small>Client</small>
            <strong>React rider app</strong>
            <p>Route selection, ride cards, Leaflet map, and live trip status.</p>
          </article>
          <article className="architecture-node node-api">
            <small>Core</small>
            <strong>Express API x2</strong>
            <p>Ride creation, driver state, matching mode, and gateway-ready services.</p>
          </article>
          <article className="architecture-node node-redis">
            <small>Realtime state</small>
            <strong>Redis + H3</strong>
            <p>Nearby driver indexing, socket scaling, and fast location lookups.</p>
          </article>
          <article className="architecture-node node-worker">
            <small>Workers</small>
            <strong>Dispatch queue</strong>
            <p>BullMQ assignment flow, driver claim handling, timeout scheduler.</p>
          </article>
          <article className="architecture-node node-store">
            <small>Storage</small>
            <strong>MongoDB</strong>
            <p>Driver profiles, ride records, assignment state, and lifecycle history.</p>
          </article>
          <article className="architecture-node node-ops">
            <small>Observability</small>
            <strong>Ops drawer</strong>
            <p>Socket events, warnings, driver pools, and dispatch timeline.</p>
          </article>
        </div>
      </section>

      <section className="showcase-experience" id="capabilities">
        <div className="showcase-section-copy">
          <p className="eyebrow">Product surfaces</p>
          <h2>Three polished experiences, one live engine.</h2>
        </div>

        <div className="experience-grid">
          <article>
            <div className="experience-visual rider-visual">
              <span className="route-dot pickup-dot" />
              <span className="route-line-art" />
              <span className="route-dot dropoff-dot" />
            </div>
            <small>Rider</small>
            <strong>Book a trip with intelligent dispatch</strong>
            <p>Choose pickup, destination, ride class, and standard or semantic matching.</p>
          </article>
          <article>
            <div className="experience-visual driver-visual">
              <span>12s</span>
            </div>
            <small>Driver</small>
            <strong>Accept live offers with timeout behavior</strong>
            <p>Drivers receive assignments, claim rides, reject offers, and complete trips.</p>
          </article>
          <article>
            <div className="experience-visual ops-visual">
              <span />
              <span />
              <span />
            </div>
            <small>Operator</small>
            <strong>Watch dispatch health and lifecycle events</strong>
            <p>Track events, warning states, driver supply, socket health, and ride progress.</p>
          </article>
        </div>
      </section>

      <section className="showcase-case-study">
        <div>
          <p className="eyebrow">Engineering story</p>
          <h2>What this project proves.</h2>
        </div>
        <div className="case-study-list">
          <article>
            <span>Problem</span>
            <p>Ride dispatch is not just CRUD. It needs live location, race-safe driver claiming, queue recovery, and clear status for every actor.</p>
          </article>
          <article>
            <span>Solution</span>
            <p>Sirat separates rider UI, driver console, core APIs, live location service, Redis indexing, and background workers while keeping the experience cohesive.</p>
          </article>
          <article>
            <span>Resume angle</span>
            <p>It demonstrates real-time systems, distributed state, async processing, geospatial matching, AI-assisted ranking, and product-grade frontend design.</p>
          </article>
        </div>
      </section>

      <section className="showcase-stack" aria-label="Technology stack">
        <div className="stack-header">
          <p className="eyebrow">Tech stack</p>
          <h2>Built with modern full-stack tools.</h2>
        </div>
        <div className="stack-grid">
          <span>React 19</span>
          <span>Vite</span>
          <span>Leaflet</span>
          <span>Express 5</span>
          <span>Socket.IO</span>
          <span>Redis</span>
          <span>H3</span>
          <span>BullMQ</span>
          <span>MongoDB</span>
          <span>Nginx</span>
          <span>TypeScript</span>
          <span>Google GenAI</span>
        </div>
      </section>

      <section className="showcase-final-cta">
        <div>
          <p className="eyebrow">Ready to review</p>
          <h2>A project page that can stand in your portfolio.</h2>
          <p>
            Open the rider flow, switch to the driver console, and use the ops drawer
            to show the complete dispatch lifecycle during interviews or resume reviews.
          </p>
        </div>
        <div className="final-cta-actions">
          <a className="intro-primary-action" href="/?demo=1" target="_blank" rel="noreferrer">
            Launch rider app
          </a>
          <a className="intro-secondary-action" href="/?view=driver">
            Driver console
          </a>
        </div>
      </section>

      <footer className="intro-footer showcase-footer">
        <div>
          <div className="brand-lockup">
            <div className="brand-mark">S</div>
            <div>
              <p>Sirat</p>
              <strong>Realtime Ride Dispatch</strong>
            </div>
          </div>
          <p>
            Full-stack ride dispatch showcase for realtime matching, driver supply,
            queue-based assignment, and operational visibility.
          </p>
        </div>
        <nav aria-label="Footer links">
          <a href="/?demo=1" target="_blank" rel="noreferrer">Rider App</a>
          <a href="/?view=driver">Driver Console</a>
          <a href="#architecture">Architecture</a>
          <a href="#capabilities">Capabilities</a>
          <span>Portfolio ready</span>
        </nav>
      </footer>
    </main>
  );
}

function App() {
  const urlParams = new URLSearchParams(window.location.search);
  const appView =
    urlParams.get("view") === "driver"
      ? "driver"
      : "rider";
  const [activeTab, setActiveTab] = useState("ride");
  const [showIntro] = useState(appView !== "driver" && urlParams.get("demo") !== "1");
  const [drivers, setDrivers] = useState([]);
  const [driverDirectory, setDriverDirectory] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [currentRide, setCurrentRide] = useState(null);
  const [assignedDriver, setAssignedDriver] = useState(null);
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [selectedPickupId, setSelectedPickupId] = useState("vashi");
  const [selectedDropoffId, setSelectedDropoffId] = useState("palm-beach");
  const [matchingMode, setMatchingMode] = useState("standard");
  const [semanticQuery, setSemanticQuery] = useState(DEFAULT_SEMANTIC_QUERY);
  const [selectedRideOption, setSelectedRideOption] = useState("mini");
  const [bookingPhase, setBookingPhase] = useState("route");
  const [actionState, setActionState] = useState("idle");
  const [isOpsDrawerOpen, setIsOpsDrawerOpen] = useState(false);
  const [notice, setNotice] = useState("Choose a ride style and request a driver.");
  const [now, setNow] = useState(Date.now());
  const [areaH3Indexes, setAreaH3Indexes] = useState([]);
  const [dispatchEvents, setDispatchEvents] = useState([]);
  const [driverRouteToPickup, setDriverRouteToPickup] = useState([]);
  const [animatedDriverPosition, setAnimatedDriverPosition] = useState(null);
  const driversRef = useRef([]);
  const subscribedH3Ref = useRef(new Set());
  const driverRouteKeyRef = useRef(null);
  const pickupRef = useRef(pickupOptions[0]);

  const pickup =
    pickupOptions.find((option) => option.id === selectedPickupId) ||
    pickupOptions[0];
  const dropoff =
    dropoffOptions.find((option) => option.id === selectedDropoffId) ||
    dropoffOptions.find((option) => option.id === pickup.defaultDropoffId) ||
    dropoffOptions[0];

  pickupRef.current = pickup;


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
      const activePickup = pickupRef.current;
      const res = await fetch(
        `${CORE_API_URL}/drivers/nearby?lat=${activePickup.lat}&lng=${activePickup.lng}&ring=${MAP_RING}`
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
  }, [pickup.id, pickup.lat, pickup.lng]);

  useEffect(() => {
    if (appView !== "driver" && activeTab !== "activity" && !isOpsDrawerOpen) {
      return;
    }

    fetchDriverDirectory();

    if (activeTab !== "activity" && !isOpsDrawerOpen) {
      return;
    }

    const intervalId = setInterval(fetchDriverDirectory, REFRESH_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [appView, activeTab, isOpsDrawerOpen]);

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
  const driverStatusCounts = driverDirectory.reduce(
    (counts, driver) => {
      const status = driver.availabilityStatus || (driver.isAvailable ? "available" : "unknown");

      return {
        ...counts,
        [status]: (counts[status] || 0) + 1,
      };
    },
    {}
  );
  const dispatchMetricCards = [
    {
      label: "Assignments",
      value: countEvents(dispatchEvents, ["ride_assigned", "ride_reassigned"]),
      tone: "good",
    },
    {
      label: "Accepted",
      value: countEvents(dispatchEvents, ["ride_accepted"]),
      tone: "good",
    },
    {
      label: "Rejected",
      value: countEvents(dispatchEvents, ["driver_rejected"]),
      tone: "warn",
    },
    {
      label: "Timed out",
      value: countEvents(dispatchEvents, ["driver_timed_out"]),
      tone: "warn",
    },
  ];
  const warningEvents = dispatchEvents.filter((event) =>
    [
      "semantic_match_failed",
      "no_candidates_found",
      "driver_claim_failed",
      "driver_timed_out",
      "driver_rejected",
      "ride_no_driver_found",
      "ride_cancelled",
    ].includes(event.event)
  );
  const latestRideEvent = dispatchEvents.find((event) => event.rideId);
  const opsDashboard = (
    <div className="activity-layout">
      <section className="activity-hero">
        <p className="eyebrow">Live dispatch stream</p>
        <h1>Ops dashboard</h1>
        <p className="lede">
          Track driver supply, dispatch health, ride lifecycle events, and socket
          state from the live backend stream.
        </p>

        <div className="activity-metrics">
          <div>
            <span>Live drivers</span>
            <strong>{drivers.length}</strong>
          </div>
          <div>
            <span>Driver pool</span>
            <strong>{driverDirectory.length || "--"}</strong>
          </div>
          <div>
            <span>Socket</span>
            <strong>{socket.connected ? "connected" : "connecting"}</strong>
          </div>
          <div>
            <span>Subscribed H3 cells</span>
            <strong>{areaH3Indexes.length || "--"}</strong>
          </div>
        </div>

        <div className="ops-status-strip">
          <div className={socket.connected ? "good" : "warn"}>
            <span />
            Socket stream
          </div>
          <div className={drivers.length > 0 ? "good" : "warn"}>
            <span />
            Nearby supply
          </div>
          <div className={warningEvents.length > 0 ? "warn" : "good"}>
            <span />
            Warning events
          </div>
        </div>
      </section>

      <section className="ops-panel">
        <div className="section-heading">
          <span>Dispatch health</span>
          <strong>{dispatchEvents.length} events</strong>
        </div>

        <div className="ops-kpi-grid">
          {dispatchMetricCards.map((metric) => (
            <article className={`ops-kpi-card ${metric.tone}`} key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </article>
          ))}
        </div>

        <div className="ops-split-grid">
          <article className="ops-summary-card">
            <span>Driver states</span>
            <div className="driver-state-list">
              <div>
                <small>Available</small>
                <strong>{driverStatusCounts.available || 0}</strong>
              </div>
              <div>
                <small>Offered</small>
                <strong>{driverStatusCounts.offered || 0}</strong>
              </div>
              <div>
                <small>Busy</small>
                <strong>{driverStatusCounts.busy || 0}</strong>
              </div>
            </div>
          </article>

          <article className="ops-summary-card">
            <span>Current ride</span>
            <strong>{currentRide?.status || "none"}</strong>
            <p>
              {currentRide?._id
                ? `ride ${String(currentRide._id).slice(-6)}`
                : latestRideEvent?.rideId
                  ? `latest ${String(latestRideEvent.rideId).slice(-6)}`
                  : "Waiting for rider activity"}
            </p>
          </article>
        </div>
      </section>

      <section className="activity-panel ops-timeline-panel">
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

      <section className="ops-panel ops-warning-panel">
        <div className="section-heading">
          <span>Attention queue</span>
          <strong>{warningEvents.length ? `${warningEvents.length} warnings` : "clear"}</strong>
        </div>

        {warningEvents.length === 0 ? (
          <div className="ops-clear-state">
            <span />
            <strong>No warnings yet</strong>
            <p>Timeouts, rejects, semantic misses, and no-driver cases will show here.</p>
          </div>
        ) : (
          <div className="ops-warning-list">
            {warningEvents.slice(0, 6).map((event) => (
              <article key={`warning-${event.eventKey}`}>
                <small>{formatEventTime(event.timestamp)}</small>
                <strong>{getDispatchEventTitle(event.event)}</strong>
                <p>{getDispatchEventSummary(event)}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );

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

    const selectDriver = (driverId) => {
      setSelectedDriverId(driverId);
      setCurrentRide(null);
      setAssignedDriver(null);
    };
    const selectedDriverZone = getDriverZoneId(selectedDriver);
    const vashiDriverOptions = driverOptions.filter(
      (driver) => getDriverZoneId(driver) === "vashi"
    );
    const kurlaDriverOptions = driverOptions.filter(
      (driver) => getDriverZoneId(driver) === "kurla"
    );

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

              <label className="driver-select legacy-driver-select">
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

              <div className="driver-zone-grid">
                <label className="driver-select driver-zone-select">
                  <span>Vashi drivers</span>
                  <select
                    value={selectedDriverZone === "vashi" ? selectedDriverId : ""}
                    onChange={(event) => selectDriver(event.target.value)}
                  >
                    <option value="" disabled>
                      Select Vashi driver
                    </option>
                    {vashiDriverOptions.map((driver) => (
                      <option key={driver._id} value={driver._id}>
                        {driver.name} - {driver.vehicle?.type || "vehicle"}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="driver-select driver-zone-select kurla">
                  <span>Kurla drivers</span>
                  <select
                    value={selectedDriverZone === "kurla" ? selectedDriverId : ""}
                    onChange={(event) => selectDriver(event.target.value)}
                    disabled={kurlaDriverOptions.length === 0}
                  >
                    <option value="" disabled>
                      Select Kurla driver
                    </option>
                    {kurlaDriverOptions.map((driver) => (
                      <option key={driver._id} value={driver._id}>
                        {driver.name} - {driver.vehicle?.type || "vehicle"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="driver-zone-counts">
                <span>{vashiDriverOptions.length} Vashi</span>
                <span>{kurlaDriverOptions.length} Kurla</span>
              </div>

              {kurlaDriverOptions.length === 0 && (
                <p className="driver-zone-hint">
                  Kurla drivers are not in the current API response yet. Restart Core API
                  after the latest backend change, then reseed if the pool is still only 100.
                </p>
              )}

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
                      <strong>Pickup point</strong>
                      <p>{currentRide.pickup?.lat}, {currentRide.pickup?.lng}</p>
                    </div>
                    <div>
                      <small>Dropoff</small>
                      <strong>Dropoff point</strong>
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

  if (showIntro) {
    return <IntroPage />;
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

        {activeTab !== "activity" && (
          <>
            <button
              className={`ops-drawer-trigger ${isOpsDrawerOpen ? "open" : ""}`}
              onClick={() => setIsOpsDrawerOpen(true)}
              type="button"
            >
              <span />
              Ops
            </button>

            <div
              className={`ops-drawer-backdrop ${isOpsDrawerOpen ? "open" : ""}`}
              onClick={() => setIsOpsDrawerOpen(false)}
            >
              <aside
                aria-label="Ops dashboard"
                className="ops-drawer"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="ops-drawer-header">
                  <div>
                    <p className="eyebrow">Live ops</p>
                    <strong>Dispatch control room</strong>
                  </div>
                  <button
                    aria-label="Close ops dashboard"
                    onClick={() => setIsOpsDrawerOpen(false)}
                    type="button"
                  >
                    X
                  </button>
                </div>
                {opsDashboard}
              </aside>
            </div>
          </>
        )}

        {activeTab === "activity" ? (
          opsDashboard
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
                      <select
                        aria-label="Pickup location"
                        value={selectedPickupId}
                        onChange={(event) => {
                          const nextPickup = pickupOptions.find(
                            (option) => option.id === event.target.value
                          );

                          setSelectedPickupId(event.target.value);
                          setSelectedDropoffId(nextPickup?.defaultDropoffId || dropoffOptions[0].id);
                          setCurrentRide(null);
                          setAssignedDriver(null);
                          setDriverRouteToPickup([]);
                          setAnimatedDriverPosition(null);
                          setBookingPhase("route");
                        }}
                      >
                        {pickupOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <p>{pickup.lat}, {pickup.lng}</p>
                    </div>
                  </div>

                  <div className="route-line">
                    <span className="route-dot dropoff-dot" />
                    <div>
                      <small>To</small>
                      <select
                        aria-label="Dropoff location"
                        value={selectedDropoffId}
                        onChange={(event) => {
                          setSelectedDropoffId(event.target.value);
                          setDriverRouteToPickup([]);
                          setAnimatedDriverPosition(null);
                        }}
                      >
                      {dropoffOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                        ))}
                      </select>
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
                <RecenterMap lat={pickup.lat} lng={pickup.lng} />

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

                <Marker position={pickupPosition} icon={pickupIcon} zIndexOffset={1000}>
                  <Popup>Pickup point</Popup>
                </Marker>

                <Marker position={dropoffPosition} icon={dropoffIcon} zIndexOffset={1000}>
                  <Popup>Dropoff point</Popup>
                </Marker>

                {showAssignedTripFocus && assignedDriverMapPosition && (
                  <Marker
                    key={`assigned-${assignedDriver._id}`}
                    position={assignedDriverMapPosition}
                    icon={driverIcon}
                    zIndexOffset={500}
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
                      zIndexOffset={0}
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
                    : `From ${pickup.label}`}
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
