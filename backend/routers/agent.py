from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from anthropic import Anthropic
from supabase import create_client
import os
import json
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()

# Lazy singletons — only created on first request
_anthropic = None
_supabase = None

def get_anthropic():
    global _anthropic
    if _anthropic is None:
        _anthropic = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    return _anthropic

def get_supabase():
    global _supabase
    if _supabase is None:
        _supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY"))
    return _supabase

class AgentRequest(BaseModel):
    transcript: str
    experiment_id: str
    sub_experiments: list[dict]
    active_sub_experiment_id: str | None = None

SYSTEM_PROMPT = """You are an AI lab assistant. The user is a scientist conducting experiments.
Your job is to listen to their voice input and return a structured JSON action.

You will receive:
- transcript: what the user said
- sub_experiments: list of active sub-experiments with their data fields
- active_sub_experiment_id: the currently active sub-experiment (if any)

Return ONLY a JSON object with no extra text. Choose one of these actions:

1. Fill in a data value:
{"action": "fill_data", "sub_experiment_id": "<id>", "field_name": "<field>", "field_value": "<value>", "unit": "<unit>", "raw_transcript": "<original text>"}

2. Switch active sub-experiment:
{"action": "switch_sub_experiment", "sub_experiment_id": "<id>", "reason": "<why>"}

3. Ask for clarification (when ambiguous):
{"action": "clarify", "question": "<what you need to know>"}

4. General note (doesn't fit any field):
{"action": "add_note", "sub_experiment_id": "<id>", "note": "<text>"}

Rules:
- Never guess a sub-experiment if it is ambiguous — use clarify instead
- Always include the raw_transcript for fill_data actions
- Match field names exactly as provided in the context
- If the fields list is empty, infer field names from the transcript and use fill_data anyway
- If the user says change or correct a previous value, still use fill_data with the corrected value
"""

@router.post("/agent")
async def run_agent(req: AgentRequest):
    print(f"[agent] transcript: {req.transcript}")
    context = {
        "transcript": req.transcript,
        "active_sub_experiment_id": req.active_sub_experiment_id,
        "sub_experiments": req.sub_experiments
    }

    try:
        print("[agent] calling Claude...")
        response = get_anthropic().messages.create(
            model="claude-opus-4-5",
            max_tokens=500,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": json.dumps(context)}]
        )
        raw = response.content[0].text.strip()
        print(f"[agent] Claude returned: {raw}")

        # Strip code fences if Claude added them
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1]  # remove first line (```json)
            raw = raw.rsplit("```", 1)[0]  # remove trailing ```
            raw = raw.strip()

        parsed = json.loads(raw)

        # Handle both single action and array of actions
        actions = parsed if isinstance(parsed, list) else [parsed]

        for action in actions:
            if action["action"] == "fill_data":
                print(f"[agent] inserting {action['field_name']} = {action['field_value']}")
                get_supabase().table("data_entries").insert({
                    "sub_experiment_id": action["sub_experiment_id"],
                    "field_name": action["field_name"],
                    "field_value": action["field_value"],
                    "unit": action.get("unit") or "",
                    "source": "voice",
                    "raw_transcript": action.get("raw_transcript", req.transcript)
                }).execute()
                print(f"[agent] inserted {action['field_name']} successfully")
            if action["action"] == "add_note":
                get_supabase().table("data_entries").insert({
                    "sub_experiment_id": action["sub_experiment_id"],
                    "field_name": "note",
                    "field_value": action["note"],
                    "unit": "",
                    "source": "voice",
                    "raw_transcript": req.transcript
                }).execute()
        return {"success": True, "action": actions[0] if len(actions) == 1 else actions}

    except json.JSONDecodeError:
        print(f"[agent] JSON parse error: {raw}")
        raise HTTPException(status_code=500, detail=f"Claude returned invalid JSON: {raw}")
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Agent error: {str(e)}")
    

class SetupRequest(BaseModel):
    message: str
    conversation_history: list[dict] = []

SETUP_SYSTEM_PROMPT = """You are helping a scientist set up a new lab experiment.
Collect three things: experiment title, sub-experiment names, and fields for each sub-experiment.

If the user provides all of this in one message, return ready immediately.
If something is missing, ask ONE concise question to get the missing piece — never ask multiple questions at once.
The only required minimum is: title + at least one sub-experiment + at least one field for that sub-experiment.

Return ONLY valid JSON, nothing else.

When ready:
{"status": "ready", "experiment": {"title": "...", "sub_experiments": [{"name": "...", "fields": ["field1", "field2"]}]}}

When still collecting:
{"status": "collecting", "message": "your single follow-up question"}
"""

@router.post("/setup/chat")
async def setup_chat(req: SetupRequest):
    messages = req.conversation_history + [
        {"role": "user", "content": req.message}
    ]

    try:
        response = get_anthropic().messages.create(
            model="claude-opus-4-5",
            max_tokens=500,
            system=SETUP_SYSTEM_PROMPT,
            messages=messages
        )

        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()

        result = json.loads(raw)

        # If ready, create the experiment in DB
        if result["status"] == "ready":
            exp_data = result["experiment"]

            # Create experiment row
            exp = get_supabase().table("experiments").insert({
                "user_id": "test-user",
                "title": exp_data["title"],
                "status": "active"
            }).execute()
            exp_id = exp.data[0]["id"]

            # Create sub-experiment rows
            sub_ids = []
            for sub in exp_data["sub_experiments"]:
                sub_row = get_supabase().table("sub_experiments").insert({
                    "experiment_id": exp_id,
                    "name": sub["name"],
                    "steps": [],
                    "status": "active"
                }).execute()
                sub_ids.append({
                    "id": sub_row.data[0]["id"],
                    "name": sub["name"],
                    "fields": sub["fields"]
                })

            return {
                "status": "ready",
                "message": f"All set! Starting your experiment: {exp_data['title']}",
                "experiment_id": exp_id,
                "sub_experiments": sub_ids
            }

        return {
            "status": "collecting",
            "message": result["message"],
            "assistant_message": {"role": "assistant", "content": raw}
        }

    except json.JSONDecodeError:
        return {"status": "collecting", "message": "Sorry, could you repeat that?"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Setup error: {str(e)}")
    

from datetime import datetime, timezone

@router.post("/setup/direct")
async def setup_direct():
    try:
        # Create experiment with default name
        title = f"Experiment · {datetime.now(timezone.utc).strftime('%b %d, %Y')}"

        exp = get_supabase().table("experiments").insert({
            "user_id": "test-user",
            "title": title,
            "status": "active"
        }).execute()
        exp_id = exp.data[0]["id"]

        # Create one unnamed sub-experiment
        sub = get_supabase().table("sub_experiments").insert({
            "experiment_id": exp_id,
            "name": "General",
            "steps": [],
            "status": "active"
        }).execute()
        sub_id = sub.data[0]["id"]

        return {
            "experiment_id": exp_id,
            "sub_experiments": [
                {"id": sub_id, "name": "General", "fields": []}
            ]
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Setup error: {str(e)}")
    


from fastapi import UploadFile, File

@router.post("/setup/upload")
async def setup_upload(file: UploadFile = File(...)):
    try:
        content = await file.read()

        # Handle different file types
        if file.filename.endswith(".txt"):
            text = content.decode("utf-8")
        elif file.filename.endswith(".pdf"):
            import io
            try:
                import pypdf
                reader = pypdf.PdfReader(io.BytesIO(content))
                text = "\n".join(page.extract_text() for page in reader.pages)
            except ImportError:
                raise HTTPException(status_code=500, detail="pypdf not installed. Run: pip install pypdf")
        elif file.filename.endswith(".docx"):
            import io
            try:
                from docx import Document as DocxDocument
                doc = DocxDocument(io.BytesIO(content))
                text = "\n".join(p.text for p in doc.paragraphs)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Error reading docx: {str(e)}")
        else:
            raise HTTPException(status_code=400, detail="Unsupported file type. Use .txt, .pdf, or .docx")

        # Ask Claude to parse structure + give feedback
        response = get_anthropic().messages.create(
            model="claude-opus-4-5",
            max_tokens=1000,
            messages=[{
                "role": "user",
                "content": f"""You are analyzing a lab experiment protocol.

Extract the experiment structure AND provide brief safety/quality feedback.

Return ONLY this JSON, no extra text:
{{
  "title": "experiment title",
  "sub_experiments": [
    {{"name": "sub-experiment name", "fields": ["field1", "field2"]}}
  ],
  "feedback": "2-3 sentences on potential risks, missing steps, or suggestions. Be specific and actionable."
}}

Protocol:
{text}"""
            }]
        )

        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()

        parsed = json.loads(raw)

        # Create experiment in DB
        exp = get_supabase().table("experiments").insert({
            "user_id": "test-user",
            "title": parsed["title"],
            "design_text": text,
            "design_feedback": parsed["feedback"],
            "status": "active"
        }).execute()
        exp_id = exp.data[0]["id"]

        # Create sub-experiments
        sub_rows = []
        for sub in parsed["sub_experiments"]:
            sub_row = get_supabase().table("sub_experiments").insert({
                "experiment_id": exp_id,
                "name": sub["name"],
                "steps": [],
                "status": "active"
            }).execute()
            sub_rows.append({
                "id": sub_row.data[0]["id"],
                "name": sub["name"],
                "fields": sub["fields"]
            })

        return {
            "experiment_id": exp_id,
            "title": parsed["title"],
            "sub_experiments": sub_rows,
            "feedback": parsed["feedback"]
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Upload error: {str(e)}")
    
import base64

class ImageConfirmRequest(BaseModel):
    sub_experiment_id: str
    field_name: str
    field_value: str
    unit: str
    image_url: str | None = None

@router.post("/vision/extract")
async def vision_extract(
    image: UploadFile = File(...),
    sub_experiment_id: str = "",
    fields: str = ""  # comma-separated field names as hint
):
    try:
        content = await image.read()
        b64 = base64.standard_b64encode(content).decode("utf-8")
        media_type = image.content_type or "image/jpeg"

        fields_hint = f"Known fields for this experiment: {fields}." if fields else ""

        response = get_anthropic().messages.create(
            model="claude-opus-4-5",
            max_tokens=500,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": b64
                        }
                    },
                    {
                        "type": "text",
                        "text": f"""Extract all numerical readings or data values from this lab image.
{fields_hint}
Return ONLY a JSON array, no extra text:
[{{"field_name": "...", "field_value": "...", "unit": "..."}}]
If no data can be extracted, return an empty array: []"""
                    }
                ]
            }]
        )

        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()

        extracted = json.loads(raw)
        return {"success": True, "extracted": extracted}

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Vision error: {str(e)}")


@router.post("/vision/confirm")
async def vision_confirm(req: ImageConfirmRequest):
    try:
        get_supabase().table("data_entries").insert({
            "sub_experiment_id": req.sub_experiment_id,
            "field_name": req.field_name,
            "field_value": req.field_value,
            "unit": req.unit,
            "source": "image",
            "raw_transcript": None,
            "image_url": req.image_url
        }).execute()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Confirm error: {str(e)}")