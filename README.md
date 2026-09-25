# SignBridge Ultimate v10 — Working Build

## Start it correctly
Do **not** double-click `frontend/index.html`. Camera permissions and ES modules require a local web origin.

### Windows
Double-click `run.bat`. It starts:
- Frontend: http://localhost:8080
- API: http://localhost:8000

### macOS / Linux
Run `./run.sh`, then open http://localhost:8080

## Backend has zero dependencies
`backend/app.py` uses only the Python standard library (`http.server`, `sqlite3`) —
no `pip install` step, no fastapi/uvicorn version issues. Any Python 3.9+ works out
of the box. Every route (`/health`, `/api/v1/gestures`, `/api/v1/messages`,
`/api/v1/feedback`, `/api/v1/analytics`) has been run and hit directly to confirm
it returns correct status codes and JSON.

## What is fixed
- All bottom/section buttons use guarded event listeners.
- Smooth navigation works without relying on fragile hash timing.
- History works with the API and falls back to browser localStorage if API is offline.
- Clear history clears both API and local history.
- Reset Twin clears the replay trace.
- Camera/model errors are surfaced in the UI.
- Frontend and backend are launched together by the run scripts.

## Live AI
The browser loads MediaPipe Tasks Vision and its gesture model from their official CDN/model hosting, so internet access is required for first model load. Camera access must be allowed.

## Current two-hand vocabulary
The project requires two detected hands for semantic fusion (`numHands: 2` in the
MediaPipe recognizer config). All 28 possible pairs across the 7 supported MediaPipe
gesture categories (Open_Palm, Thumb_Up, Thumb_Down, Closed_Fist, Victory, ILoveYou,
Pointing_Up — same-pair and cross-pair) are mapped to a SignBridge phrase, both in the
frontend `dualMap` and the backend `/api/v1/gestures` list. This is a prototype
vocabulary, not a claim of full ISL translation.
