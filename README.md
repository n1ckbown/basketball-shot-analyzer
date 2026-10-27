# Basketball Shot Analyzer

Working name; to be replaced with a more marketable one before release.

Record your basketball shooting on your phone. The app counts makes and misses and gives feedback on each shot.

- `app/`: phone app (Expo / React Native, iPhone and Android). Records video and shows results.
- `server/`: analysis server (Python / FastAPI). Finds the ball and hoop in the video, decides make or miss, and scores shot form.

Read [AGENTS.md](AGENTS.md) before contributing. It has the setup, run, test and git rules.

## Quick start (server)

```
python -m venv .venv
.venv\Scripts\activate        # Windows; use `source .venv/bin/activate` on macOS/Linux
pip install -r server/requirements.txt
python -m pytest
uvicorn app.main:app --app-dir server --reload   # then open http://127.0.0.1:8000/health
```

## Quick start (app)

Install **Expo Go** on your phone (App Store / Google Play). Your phone and computer must be on the same Wi-Fi.

```
cd app
npm install
npm test
npx expo start      # scan the QR code with Expo Go (Android) or the Camera app (iPhone)
```

## Roadmap

Each step is one pull request.

1. Project scaffold: repo, rules, server skeleton, tests (done)
2. App: record a session with the phone camera and save it to the photo library (done)
3. Server: upload endpoint that accepts a video and returns a job ID
4. Server: detect the ball and hoop in each frame
5. Server: track shots and decide make or miss, with a count per session
6. App: upload a session and show makes, misses and shooting percentage
7. Server + app: per-shot feedback (release angle, arc, left/right miss)

## Ownership

Claim an area here before working on it so two people's AI tools don't edit the same files.

| Area | Owner |
|------|-------|
| `server/` | nbown |
| `app/` | nbown |
| `AGENTS.md`, `README.md`, CI | nbown |
