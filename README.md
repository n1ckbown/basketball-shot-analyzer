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

To analyze uploads, start the server from the repo root with the fine-tuned model (see "Training the ball/hoop detector"). Add `--host 0.0.0.0` so a phone on the same Wi-Fi can reach it:

```
$env:DETECTOR_MODEL = "data\models\ball-hoop-v3"    # PowerShell
uvicorn app.main:app --app-dir server --host 0.0.0.0
```

- `POST /videos` (form field `file`, MP4 or MOV) saves the video, queues it for analysis and returns `{"job_id": ...}`. Videos are analyzed one at a time.
- `GET /videos/{job_id}` returns `{"status": "processing"}` until analysis finishes. Then it returns `{"status": "done", "attempts": 35, "makes": 11, "duration": 536.7, "shots": [{"time": 18.1, "made": true, "arc_ft": 3.4}, ...]}`, where `duration` is the video length and `time` is when the ball reached the rim, both in seconds. `arc_ft` is how many feet the ball rose above the rim, measured with gravity as the ruler. It is `null` when the top of the flight wasn't seen clearly, which is common when the rim is near the top of the picture. If analysis fails it returns `{"status": "failed", "error": ...}`.

### Using an NVIDIA GPU (recommended for detection)

`requirements.txt` installs the CPU build of PyTorch. On a machine with an NVIDIA GPU, install the CUDA build instead, then the rest:

```
pip install torch==2.14.1 torchvision==0.29.1 --index-url https://download.pytorch.org/whl/cu130
pip install -r server/requirements.txt
```

### Checking detection on a real video

```
cd server
python -m app.detection ..\data\videos\session1.mov
```

This prints the ball and hoop found in each frame and how many frames had each. The model (`DETECTOR_MODEL`, default `PekingU/rtdetr_v2_r18vd`, Apache-2.0) downloads on first run. Put local videos and datasets in `data/`, which is kept out of git.

To list every shot with make or miss instead (needs the fine-tuned model, see below):

```
python -m app.shots ..\data\videos\session1.mov
```

This assumes a still camera with the hoop in view. From a pure side view, a ball that drops just behind the net can look like a make.

### Measuring accuracy

Label a session by writing one shot per line, `m:ss make` or `m:ss miss`, at about when the ball was released. Then score every labeled session at once, from `server/`:

```
python -m app.evaluate ..\data\IMG_8838.MOV ..\data\IMG_8838_shots.txt ..\data\session2.mov ..\data\session2_shots.txt
```

It prints shots found, extra shots, and make/miss calls that were right, per session and in total, with the time of each mistake. The first run on a video saves its detections next to it, so later runs take seconds. Current score: 57 of 57 shots found, 0 extra, and 54 of 57 make/miss right (95%), across a 9-minute side view and a 4-minute ground-level session.

**Release target:** at least 95% of shots found and at least 90–95% make/miss right in every session, on 10–15 labeled sessions covering the 45° angle, several courts, indoor and outdoor, and different light. Rerun this after every rule change.

### Training the ball/hoop detector

The pretrained model has no hoop class, so we fine-tune it. Three steps, run from `server/` (a GPU is strongly recommended):

1. Download the Open Images index files (about 5.4 GB) into `data/openimages/`:
   - `imagelabels.csv` from https://storage.googleapis.com/openimages/v7/oidv7-train-annotations-human-imagelabels.csv
   - `images.csv` from https://storage.googleapis.com/openimages/v6/oidv6-train-images-with-labels-with-rotation.csv
2. `python -m training.collect` downloads every photo humans tagged as basketball, ball, hoop, rim or court (CC BY 2.0 only) and writes the photo credits to `data/openimages/attribution.csv`. **These credits must be kept**: CC BY requires crediting the photographers if the model ships.
3. `python -m training.autolabel` draws draft ball and rim boxes with Grounding DINO (Apache-2.0), drops boxes with impossible shapes, and asks CLIP (MIT) to confirm each rim box looks like a hoop, which removes balls, shot clocks and logos. Check `data/openimages/previews_autolabel/` to judge label quality.
4. `python -m training.train` fine-tunes RT-DETRv2 and saves the best model to `data/models/ball-hoop-v3`, with sample predictions in its `previews/` folder. Use it with `DETECTOR_MODEL=../data/models/ball-hoop-v3`.

Label quality in spot checks: about 9 in 10 ball boxes and 9 in 10 hoop boxes are right. Some "ball" boxes still cover the player holding the ball. The resulting model (v3: 5,880 images, 5,673 ball and 2,851 hoop boxes) found 39 of 44 labeled balls and 21 of 23 labeled hoops on held-out photos. It has not been tried on phone video yet, so check it on real footage before relying on it.

## Quick start (app)

Install **Expo Go** on your phone (App Store / Google Play). Your phone and computer must be on the same Wi-Fi.

```
cd app
npm install
npm test
npx expo start      # scan the QR code with Expo Go (Android) or the Camera app (iPhone)
```

To get makes and misses, the app uploads each recording, or a video picked with "Upload a video", to the analysis server. Start the server as described in "Quick start (server)" (with `--host 0.0.0.0`). Then put the computer's Wi-Fi address in `app/.env`, which is kept out of git, and reload the app:

```
EXPO_PUBLIC_SERVER_URL=http://192.168.1.20:8000
```

Find the address with `ipconfig` (look for "IPv4 Address" under Wi-Fi). It can change when the router hands out a new one. The first time the server runs, Windows asks whether Python may accept connections: allow it. If the Wi-Fi is set to "Public" in Windows, either allow Python on public networks or switch that network to Private.

## Roadmap

Each step is one pull request.

1. Project scaffold: repo, rules, server skeleton, tests (done)
2. App: record a session with the phone camera and save it to the photo library (done)
3. Server: upload endpoint that accepts a video and returns a job ID (done: `POST /videos`, saved to `UPLOAD_DIR`, default `uploads/`)
4. Server: detect the ball and hoop in each frame (done: `server/app/detection.py` plus a detector fine-tuned with `server/training/`)
5. Server: track shots and decide make or miss, with a count per session (done: `server/app/shots.py`; next: test on more sessions and camera angles)
6. App: upload a session and show makes, misses and shooting percentage (done: uploads after recording or a video picked from the phone, then shows the totals and each shot; tested on a real phone)
7. App: new look (in progress: Home with saved sessions and a redesigned results screen are done and tested on a phone, under `app/src/app/`; next: setup check with camera flip, then the analyzing and history screens)
8. Server + app: per-shot feedback (release angle, arc, left/right miss)

## Ownership

Claim an area here before working on it so two people's AI tools don't edit the same files.

| Area | Owner |
|------|-------|
| `server/` | nbown |
| `app/` | nbown |
| `AGENTS.md`, `README.md`, CI | nbown |
