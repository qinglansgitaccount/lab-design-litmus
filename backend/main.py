from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from routers import transcribe, agent, export, risk_flag, app_chat
import os

load_dotenv(override=False)

app = FastAPI(title="Lab Design Litmus API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://ai-lab-copilot.vercel.app",
        "https://lab-design-litmus.vercel.app",
        "https://0f124f66-c9dc-4125-be5e-9c5a9298534a-00-2w2eyiinznocw.spock.replit.dev",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(transcribe.router)
app.include_router(agent.router)
app.include_router(export.router)
app.include_router(risk_flag.router)
app.include_router(app_chat.router)

@app.get("/health")
def health():
    return {"status": "ok"}
