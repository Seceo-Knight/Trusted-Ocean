#!/usr/bin/env python3
"""
Copernicus Marine In Situ near-real-time observations (INSITU_GLO_PHYBGCWAV_DISCRETE_MYNRT_013_030).
Real measurements from moorings, drifting buoys, tide gauges, gliders and more.

Steps: download the dataset index -> keep recently updated time-series files of the chosen
platform types -> download those files -> read the latest valid near-surface values.
Prints one JSON document on stdout for the Node.js collector. Logs go to stderr.

Credentials: run `copernicusmarine login` once (stored in ~/.copernicusmarine).
"""
import argparse
import contextlib
import datetime as dt
import hashlib
import json
import math
import os
import pathlib
import sys

import numpy as np
import pandas as pd
import xarray as xr
import copernicusmarine

# Copernicus variable -> (CF standard name, expected UCUM unit)
VARIABLES = {
    "TEMP": ("sea_water_temperature", "Cel"),
    "PSAL": ("sea_water_practical_salinity", "1"),
    "VHM0": ("sea_surface_wave_significant_height", "m"),
    "VTPK": ("sea_surface_wave_period_at_variance_spectral_density_maximum", "s"),
    "VMDR": ("sea_surface_wave_from_direction", "deg"),
    "WSPD": ("wind_speed", "m/s"),
    "WDIR": ("wind_from_direction", "deg"),
    "ATMS": ("air_pressure_at_mean_sea_level", "hPa"),
    "DRYT": ("air_temperature", "Cel"),
    "SLEV": ("water_surface_height_above_reference_datum", "m"),
    "CPHL": ("mass_concentration_of_chlorophyll_in_sea_water", "mg/m3"),
    "HCSP": ("sea_water_speed", "m/s"),
    "HCDT": ("direction_of_sea_water_velocity", "deg"),
    "GSPD": ("wind_speed_of_gust", "m/s"),
    "DEWT": ("dew_point_temperature", "Cel"),
    "RELH": ("relative_humidity", "%"),
}

# Units as written in the files -> UCUM. Anything not listed is skipped (we never guess units).
UNITS = {
    "degrees_c": "Cel", "degree_celsius": "Cel", "celsius": "Cel", "degc": "Cel", "deg_c": "Cel",
    "0.001": "1", "psu": "1", "1": "1", "1e-3": "1",
    "m": "m", "meter": "m", "meters": "m", "metre": "m",
    "s": "s", "second": "s", "seconds": "s", "sec": "s",
    "degree": "deg", "degrees": "deg", "degree_true": "deg", "degrees_true": "deg", "deg": "deg",
    "m s-1": "m/s", "m/s": "m/s", "meter/second": "m/s",
    "hpa": "hPa", "mbar": "hPa", "millibar": "hPa",
    "mg m-3": "mg/m3", "mg/m3": "mg/m3", "milligram/m3": "mg/m3",
    "%": "%", "percent": "%",
}


def log(msg):
    print(f"[copernicus] {msg}", file=sys.stderr, flush=True)


def quiet():
    # the toolbox may print to stdout; stdout is reserved for our JSON
    return contextlib.redirect_stdout(sys.stderr)


def read_index(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        lines = f.readlines()
    header_at = next(i for i, l in enumerate(lines) if "file_name" in l and "," in l)
    df = pd.read_csv(path, skiprows=header_at)
    df.columns = [c.strip().lstrip("#").strip() for c in df.columns]
    for c in ("geospatial_lat_min", "geospatial_lat_max", "geospatial_lon_min", "geospatial_lon_max"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    for c in ("time_coverage_start", "time_coverage_end", "date_update"):
        df[c] = pd.to_datetime(df[c], utc=True, format="mixed", errors="coerce")
    return df


def platform_info(file_name):
    # e.g. .../latest/20261117/NO_TS_TG_ZwartsluisTG_20261117.nc
    #        region _ data type (TS time series, PR profile) _ platform type _ platform code _ date
    base = os.path.basename(str(file_name))
    stem = base[:-3] if base.endswith(".nc") else base
    parts = stem.split("_")
    if len(parts) >= 6 and parts[1] == "LATEST":  # older naming: GL_LATEST_TS_MO_<code>_<date>
        parts = [parts[0]] + parts[2:]
    if len(parts) < 5:
        return None
    return {"data_type": parts[1], "platform_type": parts[2], "platform_code": "_".join(parts[3:-1]), "file": base}


def select_files(df, hours, types, max_files, bbox):
    now = pd.Timestamp.now(tz="UTC")
    df = df[df["date_update"] >= now - pd.Timedelta(hours=hours)].copy()
    info = df["file_name"].map(platform_info)
    df = df[info.notna()].copy()
    info = info[info.notna()]
    df["data_type"] = [i["data_type"] for i in info]
    df["platform_type"] = [i["platform_type"] for i in info]
    df["platform_code"] = [i["platform_code"] for i in info]
    df = df[(df["data_type"] == "TS") & (df["platform_type"].isin(types))]
    if bbox:
        lon_min, lat_min, lon_max, lat_max = bbox
        df = df[(df["geospatial_lon_max"] >= lon_min) & (df["geospatial_lon_min"] <= lon_max)
                & (df["geospatial_lat_max"] >= lat_min) & (df["geospatial_lat_min"] <= lat_max)]
    # newest file per platform
    df = df.sort_values("time_coverage_end", ascending=False).drop_duplicates("platform_code")
    # fair share across platform types (tide gauges update most often and would crowd out buoys):
    # take the 1st newest of each type, then the 2nd of each type, and so on
    df["_rank"] = df.groupby("platform_type").cumcount()
    df = df.sort_values(["_rank", "time_coverage_end"], ascending=[True, False]).drop(columns="_rank")
    return df.head(max_files)


def flat(ds, name):
    return np.asarray(ds[name].values).reshape(-1) if name in ds.variables else None


def as_float(v):
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def latest_record(path, now):
    with xr.open_dataset(path, decode_timedelta=False) as ds:
        if "TIME" not in ds.variables:
            return None, "no TIME variable"
        times = pd.to_datetime(np.asarray(ds["TIME"].values).reshape(-1), utc=True, errors="coerce")
        n = len(times)
        lats, lons = flat(ds, "LATITUDE"), flat(ds, "LONGITUDE")
        if lats is None or lons is None:
            return None, "no position"
        depth_name = "DEPH" if "DEPH" in ds.variables else ("PRES" if "PRES" in ds.variables else None)
        depth = np.asarray(ds[depth_name].values) if depth_name else None

        present = []
        for var, (cf, ucum) in VARIABLES.items():
            if var not in ds.variables:
                continue
            unit = UNITS.get(str(ds[var].attrs.get("units", "")).strip().lower())
            if unit != ucum:
                continue  # unknown unit: skip instead of guessing
            arr = np.asarray(ds[var].values, dtype="float64")
            if arr.ndim == 1:
                arr = arr.reshape(-1, 1)
            if arr.ndim != 2 or arr.shape[0] != n:
                continue
            qc = None
            if f"{var}_QC" in ds.variables:
                qc = np.asarray(ds[f"{var}_QC"].values, dtype="float64")
                if qc.ndim == 1:
                    qc = qc.reshape(-1, 1)
                if qc.shape != arr.shape:
                    qc = None
            present.append((var, cf, ucum, arr, qc))
        if not present:
            return None, "no supported variables"

        limit = now + pd.Timedelta(hours=1)
        for ti in range(n - 1, -1, -1):
            t = times[ti]
            if pd.isna(t) or t > limit:
                continue
            params, depth_used = [], None
            for var, cf, ucum, arr, qc in present:
                row = arr[ti]
                ok = [k for k in range(row.shape[0]) if math.isfinite(row[k])]
                if not ok:
                    continue
                if depth is not None and depth.ndim == 2 and depth.shape == arr.shape:
                    k = min(ok, key=lambda j: depth[ti, j] if math.isfinite(depth[ti, j]) else 1e9)
                    d = as_float(depth[ti, k])
                else:
                    k, d = ok[0], None
                flag = as_float(qc[ti, k]) if qc is not None else None
                if flag in (3.0, 4.0):
                    continue  # provider says bad / probably bad
                params.append({"var": var, "name": cf, "value": float(row[k]), "unit": ucum,
                               "provider_qc": int(flag) if flag is not None else None})
                if d is not None and (depth_used is None or d < depth_used):
                    depth_used = d
            if params:
                pi = ti if len(lats) == n else len(lats) - 1
                lat, lon = as_float(lats[pi]), as_float(lons[pi])
                if lat is None or lon is None:
                    return None, "invalid position"
                return {
                    "time": t.isoformat().replace("+00:00", "Z"),
                    "lat": lat, "lon": lon,
                    "depth_m": depth_used if depth_used is not None else 0.0,
                    "parameters": params,
                    "institution": str(ds.attrs.get("institution", "")),
                    "platform_name": str(ds.attrs.get("platform_name", "") or ds.attrs.get("platform_code", "")),
                    "data_mode": str(ds.attrs.get("data_mode", "")),
                }, None
        return None, "no valid recent values"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work-dir", required=True)
    ap.add_argument("--dataset-id", default="cmems_obs-ins_glo_phybgcwav_mynrt_na_irr")
    ap.add_argument("--hours", type=int, default=24)
    ap.add_argument("--types", default="MO,DB,TG,GL,SD,FB")
    ap.add_argument("--max-files", type=int, default=300)
    ap.add_argument("--bbox", default="", help="lon_min,lat_min,lon_max,lat_max (empty = global)")
    a = ap.parse_args()

    work = pathlib.Path(a.work_dir)
    (work / "index").mkdir(parents=True, exist_ok=True)
    (work / "files").mkdir(parents=True, exist_ok=True)
    bbox = [float(x) for x in a.bbox.split(",")] if a.bbox.strip() else None
    types = [t.strip().upper() for t in a.types.split(",") if t.strip()]
    now = pd.Timestamp.now(tz="UTC")

    index_path = work / "index" / "index_latest.txt"
    log("downloading dataset index (latest part only)")
    got_index = False
    try:
        only_latest = work / "index_list.txt"
        only_latest.write_text("index_latest.txt\n")
        with quiet():
            resp = copernicusmarine.get(dataset_id=a.dataset_id, file_list=str(only_latest), no_directories=True,
                                        output_directory=str(work / "index"), overwrite=True, disable_progress_bar=True)
        got_index = any(os.path.basename(str(f.file_path)) == "index_latest.txt" and os.path.exists(str(f.file_path))
                        for f in resp.files)
    except Exception as e:
        log(f"direct index download failed ({type(e).__name__})")
    if not got_index:
        log("falling back to downloading all index files")
        with quiet():
            copernicusmarine.get(dataset_id=a.dataset_id, index_parts=True, no_directories=True,
                                 output_directory=str(work / "index"), overwrite=True, disable_progress_bar=True)
    if not index_path.exists():
        raise SystemExit("index_latest.txt was not downloaded")
    index_sha256 = hashlib.sha256(index_path.read_bytes()).hexdigest()
    df = read_index(index_path)
    sel = select_files(df, a.hours, types, a.max_files, bbox)
    log(f"index rows {len(df)}, selected {len(sel)} platforms")

    out = {"dataset_id": a.dataset_id, "index_sha256": index_sha256, "files_selected": int(len(sel)),
           "files_read": 0, "records": [], "skipped": {}}
    if len(sel):
        file_list = work / "file_list.txt"
        sel["file_name"].to_csv(file_list, index=False, header=False)
        log("downloading files")
        with quiet():
            resp = copernicusmarine.get(dataset_id=a.dataset_id, file_list=str(file_list), no_directories=True,
                                        output_directory=str(work / "files"), overwrite=True, disable_progress_bar=True)
        local = {os.path.basename(str(f.file_path)): str(f.file_path) for f in resp.files}
        for _, r in sel.iterrows():
            info = platform_info(r["file_name"])
            path = local.get(info["file"])
            if not path or not os.path.exists(path):
                out["skipped"]["not_downloaded"] = out["skipped"].get("not_downloaded", 0) + 1
                continue
            try:
                rec, why = latest_record(path, now)
            except Exception as e:  # one broken file must not stop the batch
                rec, why = None, f"read error: {type(e).__name__}"
            if rec is None:
                out["skipped"][why] = out["skipped"].get(why, 0) + 1
                continue
            with open(path, "rb") as fh:
                rec["file_sha256"] = hashlib.sha256(fh.read()).hexdigest()
            rec.update({"platform_code": info["platform_code"], "platform_type": info["platform_type"],
                        "file_name": info["file"], "provider": str(r.get("provider", ""))})
            out["records"].append(rec)
            out["files_read"] += 1
    print(json.dumps(out))


if __name__ == "__main__":
    main()
