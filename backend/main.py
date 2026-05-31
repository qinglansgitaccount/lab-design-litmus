from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from routers import transcribe, agent, export, risk_flag, app_chat



load_dotenv(override=False)

app = FastAPI(title="Lab Design Litmus API")
app.include_router(app_chat.router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://ai-lab-copilot.vercel.app",
        "https://lab-design-litmus.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(transcribe.router)
app.include_router(agent.router)
app.include_router(export.router)
app.include_router(risk_flag.router)

@app.get("/health")
def health():
    return {"status": "ok"}


import os
