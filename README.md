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

## Roadmap

Each step is one pull request.

1. Project scaffold: repo, rules, server skeleton, tests (done)
2. App: record a session with the phone camera and save it to the photo library (done)
3. Server: upload endpoint that accepts a video and returns a job ID (done: `POST /videos`, saved to `UPLOAD_DIR`, default `uploads/`)
4. Server: detect the ball and hoop in each frame (pipeline in `server/app/detection.py` and a fine-tuned detector from `server/training/`; next: check it on real session videos)
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
