from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.tracing import instrument_app
from app.routes.notifications import router as notifications_router
from app.routes.runs import router as runs_router

app = FastAPI(title="Agent Platform — Employee Request Assistant")

settings = get_settings()
origins = [o.strip() for o in settings.allowed_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(runs_router)
app.include_router(notifications_router)
instrument_app(app)


@app.get("/health")
def health():
    return {"status": "ok"}
