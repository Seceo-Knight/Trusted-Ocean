# Trusted Ocean Observation Platform

Software platform that collects **real** ocean data from public sources, checks it,
signs it with post-quantum cryptography, archives it on IPFS, anchors proofs on a
blockchain, and serves it through APIs and a Node.js/React dashboard.

Based on the manager's documents: Delivery Plan (PPT), High-Level Design and
Architecture & Integration Reference. No dummy or simulated data is used.

## Build roadmap

| Step | What | Status |
|---|---|---|
| 1 | Backend skeleton + first real collector (NOAA NDBC buoys) | Done |
| 2 | More collectors: Argo, Copernicus Marine, OBIS done; EMODnet, GBIF, NOAA ERDDAP, tides, AIS next | In progress |
| 3 | TimescaleDB time-series database + query API | Done |
| 4 | Post-quantum signing of every batch (ML-DSA) | Planned |
| 5 | IPFS archive (encrypted Zarr datasets) | Planned |
| 6 | Blockchain anchoring (Hyperledger Besu) + proof API | Planned |
| 7 | Dashboard (React + MUI, SeceoKnight design style) + live map | Done (v1) |
| 8 | AI: anomaly detection and alerts | Planned |

## Data sources

| Source | Licence | Commercial use | Status |
|---|---|---|---|
| NOAA NDBC buoys | Public domain | Yes | Step 1 |
| Copernicus Marine | Copernicus Marine licence, credit required | Yes | Step 2 (needs free account) |
| Argo / OceanSITES | Open, credit required | Yes | Step 2 |
| EMODnet / EDITO | Open, credit required | Yes | Step 2 |
| OBIS / GBIF / WoRMS | Per dataset (CC0 / CC BY kept, NC filtered out) | Yes, after filter | Step 2 |
| NOAA ERDDAP, NOAA Tides | Public domain | Yes | Step 2 |
| aisstream.io (ships) | Free key, beta | Check terms | Step 2 |
| INCOIS, Ocean Networks Canada | Check with provider | To confirm | Decision needed |
| Open-Meteo Marine | Paid licence for commercial | Paid | Decision needed |
| Global Fishing Watch | Non-commercial only | No | Excluded for clients |

## Run on the Mac (development)

    cd "~/Trusted Ocean/backend"
    cp .env.example .env     # first time only, then set DB_PASSWORD
    npm install
    npm run setup:python     # first time only (Copernicus)
    npm run db:up            # start the database (Docker Desktop must be running)
    npm start                # API on http://127.0.0.1:4100, collectors run on schedule

Dashboard (second Terminal window):

    cd "~/Trusted Ocean/frontend"
    npm install              # first time only
    npm run dev              # open http://127.0.0.1:5173

Production: `npm run build` in frontend/, then the backend serves the dashboard itself on port 4100.

API:
- `GET /api/v1/health`, `/sources`, `/stats`
- `GET /api/v1/devices?source=&bbox=lon_min,lat_min,lon_max,lat_max&active_hours=`
- `GET /api/v1/observations/latest?parameter=sea_surface_temperature&bbox=&hours=`
- `GET /api/v1/devices/{did}/timeseries?parameter=&from=&to=`
- `GET /api/v1/biodiversity/occurrences?bbox=&aphia_id=&from=&to=`
- `GET /api/v1/biodiversity/taxa?bbox=`, `/biodiversity/sites?bbox=&aphia_id=`, `/biodiversity/site?lon=&lat=`, `/biodiversity/datasets?bbox=`
