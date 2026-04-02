from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from routers import transcribe, agent, export, risk_flag

load_dotenv()

app = FastAPI(title="AI Lab Copilot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
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