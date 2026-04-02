from fastapi import APIRouter, UploadFile, File, HTTPException
from openai import OpenAI
import os

router = APIRouter()

@router.post("/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)):
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    if not audio.content_type.startswith("audio/"):
        raise HTTPException(status_code=400, detail="Please upload an audio file")

    try:
        audio_bytes = await audio.read()
        transcription = client.audio.transcriptions.create(
            model="whisper-1",
            file=(audio.filename, audio_bytes, audio.content_type),
            prompt="This is a lab experiment recording. It may contain scientific terms, values, and units such as pH, OD600, mL, μL, rpm, etc."
        )
        return {"success": True, "text": transcription.text}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")