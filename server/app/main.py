from fastapi import FastAPI

app = FastAPI(title="Basketball Shot Analyzer server")


@app.get("/health")
def health():
    return {"status": "ok"}
