from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from anthropic import Anthropic
from dotenv import load_dotenv
import os
import json

load_dotenv(override=False)

router = APIRouter()


def get_anthropic():
    return Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


PRE_ANALYSIS_SYSTEM = """You are a helpful AI research assistant helping a scientist prepare for experiment design risk analysis.

Your job is to have a friendly, concise conversation to understand:
1. What research question the experiment is trying to answer
2. What a successful result would look like
3. Any relevant lab context (experience level, prior attempts, known constraints)

Keep responses SHORT (2-3 sentences max). Ask one question at a time.
Be conversational and supportive — these are often junior researchers.
Once you have enough context (research question + success criteria at minimum), 
tell the user they can now click "Analyze" and you'll include this context in the analysis.

Do NOT run the analysis yourself. Just collect context through conversation.
"""

POST_ANALYSIS_SYSTEM_TEMPLATE = """You are an AI lab assistant helping a junior researcher understand and act on their experiment design risk analysis.

Current protocol:
{protocol}

Risk flags identified:
{risks}

You can:
1. Answer questions about any specific risk flag
2. Explain why something matters for their specific experiment  
3. Suggest how to address a risk
4. Edit the protocol when the user requests changes

When editing the protocol, return JSON: {{"type": "protocol_update", "updated_protocol": "...", "content": "what changed and why"}}
For all other responses, return JSON: {{"type": "answer", "content": "your response"}}

Keep answers concise and practical. You are NOT replacing their advisor — you are helping them prepare better questions for that conversation.
"""


class AppChatRequest(BaseModel):
    message: str
    conversation_history: list[dict] = []
    mode: str = "pre"  # "pre" or "post"
    protocol_text: str = ""
    risk_items: list[dict] = []


@router.post("/app/chat")
async def app_chat(req: AppChatRequest):
    try:
        if req.mode == "pre":
            system = PRE_ANALYSIS_SYSTEM
        else:
            system = POST_ANALYSIS_SYSTEM_TEMPLATE.format(
                protocol=req.protocol_text[:2000],
                risks=json.dumps(req.risk_items, indent=2)
            )

        messages = req.conversation_history + [
            {"role": "user", "content": req.message}
        ]

        response = get_anthropic().messages.create(
            model="claude-opus-4-5",
            max_tokens=400,
            system=system,
            messages=messages
        )

        raw = response.content[0].text.strip()

        # Post-analysis may return JSON for protocol updates
        if req.mode == "post":
            try:
                if raw.startswith("```"):
                    raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
                result = json.loads(raw)
                return result
            except json.JSONDecodeError:
                return {"type": "answer", "content": raw}

        return {"type": "answer", "content": raw}

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Chat error: {str(e)}")