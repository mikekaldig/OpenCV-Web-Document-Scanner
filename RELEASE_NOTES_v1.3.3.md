# OpenCV Web Document Scanner v1.3.3 – Release Notes

Date: 2025-09-14

## Highlights

- WebGL Preprocessing (PoC): Optional grayscale + 3×3 blur via shader, toggle in UI; safe CPU fallback; core detection unchanged
- Performance Test Tool: Timed runs with periodic PERF_SNAPSHOT logs and final VALIDATION_SUMMARY
- Client Log Uploads: Full client debug log per test uploaded to `/save-client-log` into `versions/v1.3.3/test-logs/`
- Overlay Accuracy Fixes: Canvas aligned 1:1 to video pixels, corrected mapping (no left/right margins)

## Changes

- UI: Added top-right toggles (WebGL PoC, Test Mode, Perf Test)
- JS: Robust OpenCV ready; idempotent WebGL init; improved error hooks; per-window perf counters (WebGL vs CPU)
- Server: Python HTTPS (TLS ≥ 1.2) with `/log`, `/save-image`, `/save-client-log`, log rotation (5MB), no-cache headers
- Docs: Updated README and VERSION for v1.3.3; added this release notes file

## Observations

- Initial measurements show CPU baseline (~71–75 ms/frame) faster than WebGL PoC (~85 ms/frame) on tested devices; PoC remains optional
- Quality toggles (downscale/extra blur) were tested and reverted to restore stable detection quality

## How to run

```bash
cd versions/v1.3.3
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes \
  -subj "/C=DE/ST=State/L=City/O=Organization/OU=OrgUnit/CN=localhost"
python3 server.py
```
Open https://localhost:8000 (accept self-signed cert), use the top-right toggles for tests.
