from fastapi import FastAPI

app = FastAPI(title="Hoops analysis server")


@app.get("/health")
def health():
    return {"status": "ok"}
