# Sirat Commands

Run these from `C:\sirat` unless a command says otherwise.

## Backend Docker Stack

Start all backend services:

```powershell
docker compose up --build
```

Starts Redis, location-service, two core APIs, nginx, dispatch worker, and ride timeout scheduler.

Start existing containers without rebuilding:

```powershell
docker compose up
```

Stop backend services:

```powershell
docker compose down
```

Check running containers:

```powershell
docker ps
```

## Driver Simulator

Run simulator locally:

```powershell
npm run simulator:drivers
```

Moves available drivers and pushes live locations into the location service.

## Frontend

Run map UI through nginx/load balancer:

```powershell
cd C:\sirat\apps\map-ui
npm run dev:lb
```

Open:

```text
http://localhost:5173/
```

Driver offer console:

```text
http://localhost:5173/?view=driver
```

Build frontend:

```powershell
cd C:\sirat\apps\map-ui
npm run build
```

## Load-Test Cleanup

Preview load-test cleanup:

```powershell
npm run reset:loadtest
```

Delete load-test rides and release matching drivers:

```powershell
npm run reset:loadtest -- --confirm
```

Use this before/after k6 runs.

## k6 Load Tests

Mixed dispatch test:

```powershell
docker compose --profile loadtest run --rm k6-mixed
```

Runs mixed traffic: mostly `GET /drivers/nearby`, some `POST /rides`.

Mixed dispatch test at 75 RPS:

```powershell
docker compose --profile loadtest run --rm k6-mixed-75
```

Runs the same mixed traffic pattern at 75 requests/second.

Nearby drivers read test:

```powershell
docker compose --profile loadtest run --rm k6-nearby
```

Tests `GET /drivers/nearby` throughput/latency.

Ride create test:

```powershell
docker compose --profile loadtest run --rm k6
```

Tests `POST /rides` creation and dispatch queueing.

## Recommended Load-Test Flow

1. Start backend:

```powershell
docker compose up --build
```

2. In another terminal, start simulator:

```powershell
npm run simulator:drivers
```

3. In another terminal, clean old test rides:

```powershell
npm run reset:loadtest -- --confirm
```

4. Run mixed test:

```powershell
docker compose --profile loadtest run --rm k6-mixed
```

5. Clean again after test:

```powershell
npm run reset:loadtest -- --confirm
```

## Useful Checks

Check nginx load-balancing response headers:

```powershell
1..10 | ForEach-Object {
  curl.exe -s -D - "http://localhost:8080/drivers/nearby?lat=19.07&lng=73&ring=2" -o NUL |
  Select-String "X-Instance-Id"
}
```

You should see both `core-api-1` and `core-api-2`.

Check nearby drivers directly:

```powershell
curl.exe "http://localhost:8080/drivers/nearby?lat=19.07&lng=73&ring=2"
```

## Git

Check changes:

```powershell
git status
```

Add all changes:

```powershell
git add .
```

Commit:

```powershell
git commit -m "Your message"
```

Push:

```powershell
git push
```
