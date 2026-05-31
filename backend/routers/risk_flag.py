from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel
from anthropic import Anthropic
from openai import OpenAI as DeepSeekClient
from dotenv import load_dotenv
import re
import os
import json
import requests
import xmltodict
import asyncio
import tempfile
from concurrent.futures import ThreadPoolExecutor

load_dotenv(override=False)

router = APIRouter()
executor = ThreadPoolExecutor(max_workers=4)


def get_anthropic():
    return Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


def get_deepseek():
    return DeepSeekClient(
        api_key=os.getenv("DEEPSEEK_API_KEY"), base_url="https://api.deepseek.com"
    )


# ── Step 1: Extract search queries ──────────────────────────


def extract_search_queries(experiment_description: str) -> list[str]:
    response = get_deepseek().chat.completions.create(
        model="deepseek-chat",
        max_tokens=300,
        messages=[
            {
                "role": "user",
                "content": f"""From this experiment description, extract 3-5 specific search queries
for finding relevant scientific literature about potential risks and best practices.
Focus on: experimental method, key parameters, materials, safety-critical steps.
Return ONLY a JSON array of strings. No explanation, no markdown.

Experiment: {experiment_description}""",
            }
        ],
    )
    raw = (response.choices[0].message.content or "").strip()
    if not raw:
        raw = (response.choices[0].message.reasoning_content or "").strip()
    print(f"[risk_flag] extract_search_queries raw: {repr(raw[:200])}")
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    match = re.search(r"\[.*?\]", raw, re.DOTALL)
    if match:
        return json.loads(match.group())
    return json.loads(raw)


# ── Step 2a: Semantic Scholar ────────────────────────────────


def search_semantic_scholar(query: str, limit: int = 5) -> list[dict]:
    try:
        url = "https://api.semanticscholar.org/graph/v1/paper/search"
        params = {
            "query": query,
            "limit": limit,
            "fields": "title,abstract,authors,year,externalIds,openAccessPdf",
        }
        headers = {}
        api_key = os.getenv("SEMANTIC_SCHOLAR_API_KEY")
        if api_key:
            headers["x-api-key"] = api_key

        res = requests.get(url, params=params, headers=headers, timeout=10)
        papers = res.json().get("data", [])

        return [
            {
                "title": p.get("title", ""),
                "abstract": p.get("abstract", ""),
                "year": p.get("year", ""),
                "doi": p.get("externalIds", {}).get("DOI", ""),
                "source": "Semantic Scholar",
            }
            for p in papers
            if p.get("abstract")
        ]

    except Exception as e:
        print(f"[risk_flag] Semantic Scholar error: {e}")
        return []


# ── Step 2b: PubMed ──────────────────────────────────────────


def search_pubmed(query: str, limit: int = 5) -> list[dict]:
    try:
        search_res = requests.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
            params={"db": "pubmed", "term": query, "retmax": limit, "retmode": "json"},
            timeout=10,
        ).json()
        pmids = search_res["esearchresult"]["idlist"]
        if not pmids:
            return []

        fetch_res = requests.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi",
            params={"db": "pubmed", "id": ",".join(pmids), "retmode": "xml"},
            timeout=10,
        )
        data = xmltodict.parse(fetch_res.text)
        articles = data.get("PubmedArticleSet", {}).get("PubmedArticle", [])
        if isinstance(articles, dict):
            articles = [articles]

        papers = []
        for article in articles:
            try:
                medline = article["MedlineCitation"]
                article_data = medline["Article"]

                title = article_data.get("ArticleTitle", "")
                if isinstance(title, dict):
                    title = title.get("#text", "")

                abstract_obj = article_data.get("Abstract", {}).get("AbstractText", "")
                if isinstance(abstract_obj, list):
                    abstract = " ".join(
                        a.get("#text", a) if isinstance(a, dict) else a
                        for a in abstract_obj
                    )
                elif isinstance(abstract_obj, dict):
                    abstract = abstract_obj.get("#text", "")
                else:
                    abstract = abstract_obj or ""

                doi = ""
                id_list = (
                    article.get("PubmedData", {})
                    .get("ArticleIdList", {})
                    .get("ArticleId", [])
                )
                if isinstance(id_list, dict):
                    id_list = [id_list]
                for id_item in id_list:
                    if isinstance(id_item, dict) and id_item.get("@IdType") == "doi":
                        doi = id_item.get("#text", "")

                year = medline.get("DateCompleted", {}).get("Year", "")

                if abstract:
                    papers.append(
                        {
                            "title": title,
                            "abstract": abstract,
                            "year": year,
                            "doi": doi,
                            "source": "PubMed",
                        }
                    )
            except Exception:
                continue

        return papers

    except Exception as e:
        print(f"[risk_flag] PubMed error: {e}")
        return []


# ── Step 3-5: RAG prompt + structured output ─────────────────


def generate_risk_flags(
    experiment_description: str,
    onboarding_context: str = "",
    previous_risk_items: list = None,
) -> dict:
    print("[risk_flag] extracting search queries...")
    queries = extract_search_queries(experiment_description)
    print(f"[risk_flag] queries: {queries}")

    all_papers = []
    with ThreadPoolExecutor(max_workers=6) as ex:
        ss_futures = [ex.submit(search_semantic_scholar, q, 4) for q in queries]
        pm_futures = [ex.submit(search_pubmed, q, 3) for q in queries]
        for f in ss_futures + pm_futures:
            all_papers.extend(f.result())

    seen = set()
    papers = []
    for p in all_papers:
        key = p["doi"] or p["title"]
        if key and key not in seen and len(papers) < 15:
            seen.add(key)
            papers.append(p)

    print(f"[risk_flag] retrieved {len(papers)} unique papers")

    if not papers:
        return {
            "risk_items": [],
            "papers_retrieved": 0,
            "warning": "No papers retrieved — check API connectivity",
        }

    literature_context = ""
    for i, p in enumerate(papers):
        literature_context += f"""
[{i + 1}] {p["title"]} ({p["year"]}) — {p["source"]}
DOI: {p["doi"] or "N/A"}
Abstract: {p["abstract"][:600]}
"""

    # Build onboarding context section
    onboarding_section = ""
    if onboarding_context.strip():
        onboarding_section = f"""
RESEARCHER CONTEXT:
{onboarding_context}
"""

    # Build revision note if this is a follow-up
    revision_section = ""
    if previous_risk_items:
        prev_titles = [item.get("risk", "") for item in previous_risk_items]
        revision_section = f"""
NOTE: This is a revised version of a previously analyzed protocol. Previously flagged risks were:
{json.dumps(prev_titles, indent=2)}
At the end of your analysis, add a brief note on which previous risks appear to have been addressed and which remain.
"""

    prompt = f"""You are an expert scientific advisor performing a full logical inspection of an experiment design for a junior researcher (undergraduate or early PhD student).

Your goal: reason from "Given this research goal, what could invalidate the results?"

Inspect comprehensively for:
- Whether this experimental design can actually answer the stated research question
- Missing or inadequate controls (positive, negative, loading, normalization, technical replicates)
- Parameter values outside ranges established in the literature
- Known failure modes for this assay type or reagent combination
- Sample size / replicate count insufficiency
- Confounding variables not accounted for
- Reagent-specific issues documented in the literature
- Logical gaps between the stated method and the stated goal
{onboarding_section}
EXPERIMENT DESCRIPTION:
{experiment_description}

RETRIEVED LITERATURE (cite ONLY from this list — do NOT use papers not listed here):
{literature_context}

SEVERITY DEFINITIONS:
- high: this issue is likely to invalidate or severely compromise the results if not addressed
- medium: worth verifying before proceeding; could affect result interpretation
- suggestion: not a risk per se, but a consideration that could improve the experiment

STRICT RULES:
- Every flag MUST cite at least one paper from the list above using its bracket number
- Do NOT include any flag that cannot be grounded in a retrieved paper
- Do NOT hallucinate citations — only use papers in the list
- Be specific to this experiment, not generic
- Tone: collegial and practical, not alarming
{revision_section}
Return ONLY a JSON array (no markdown, no explanation):
[{{
  "severity": "high|medium|suggestion",
  "risk": "Short title (10 words or fewer)",
  "explanation": "Why this matters for this specific experiment (1-2 sentences)",
  "suggestion": "Concrete thing to check or adjust (1-2 sentences)",
  "citation_indices": [1, 3]
}}]"""

    response = get_deepseek().chat.completions.create(
        model="deepseek-chat",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = (response.choices[0].message.content or "").strip()
    if not raw:
        raw = (response.choices[0].message.reasoning_content or "").strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()

    match = re.search(r"\[.*\]", raw, re.DOTALL)
    if match:
        risk_items = json.loads(match.group())
    else:
        risk_items = json.loads(raw)

    for item in risk_items:
        item["sources"] = [
            {
                "title": papers[i - 1]["title"],
                "year": papers[i - 1]["year"],
                "doi": papers[i - 1]["doi"],
                "url": f"https://doi.org/{papers[i - 1]['doi']}"
                if papers[i - 1]["doi"]
                else None,
                "source": papers[i - 1]["source"],
            }
            for i in item.get("citation_indices", [])
            if 0 < i <= len(papers)
        ]
        del item["citation_indices"]

    return {"risk_items": risk_items, "papers_retrieved": len(papers)}


# ── Endpoints ─────────────────────────────────────────────────


class RiskFlagRequest(BaseModel):
    experiment_description: str
    experiment_id: str | None = None
    onboarding_context: str = ""
    previous_risk_items: list | None = None


@router.post("/analyze-experiment-design")
async def analyze_experiment_design(req: RiskFlagRequest):
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            executor,
            lambda: generate_risk_flags(
                req.experiment_description,
                req.onboarding_context,
                req.previous_risk_items,
            ),
        )

        if req.experiment_id and result["risk_items"]:
            from supabase import create_client

            sb = create_client(
                os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY")
            )
            sb.table("experiments").update(
                {"design_feedback": json.dumps(result["risk_items"])}
            ).eq("id", req.experiment_id).execute()

        return result

    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=500, detail=f"DeepSeek returned invalid JSON: {str(e)}"
        )
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Risk flag error: {str(e)}")


# ── Text extraction (for supplementary files) ────────────────


@router.post("/extract-text")
async def extract_text(file: UploadFile = File(...)):
    try:
        content = await file.read()
        text = ""

        if file.filename.endswith(".txt"):
            text = content.decode("utf-8", errors="ignore")
        elif file.filename.endswith(".pdf"):
            import io

            try:
                import fitz

                doc = fitz.open(stream=io.BytesIO(content), filetype="pdf")
                text = "\n".join(page.get_text() for page in doc)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"PDF read error: {str(e)}")
        elif file.filename.endswith(".docx"):
            import io

            try:
                from docx import Document as DocxDocument

                doc = DocxDocument(io.BytesIO(content))
                text = "\n".join(p.text for p in doc.paragraphs)
            except Exception as e:
                raise HTTPException(
                    status_code=500, detail=f"DOCX read error: {str(e)}"
                )
        else:
            raise HTTPException(
                status_code=400,
                detail="Unsupported file type. Use .txt, .pdf, or .docx",
            )

        return {"text": text.strip()}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Extract error: {str(e)}")


# ── Risk chat ────────────────────────────────────────────────


class RiskChatRequest(BaseModel):
    message: str
    protocol_text: str
    risk_items: list[dict]
    conversation_history: list[dict] = []
    experiment_id: str | None = None


@router.post("/risk/chat")
async def risk_chat(req: RiskChatRequest):
    try:
        risk_context = json.dumps(req.risk_items, indent=2)

        system = f"""You are an AI lab assistant helping a junior researcher review and refine their experiment protocol.

You have access to:
1. The current protocol text
2. Risk flags identified from scientific literature

You can do two things:
- Answer questions about the risks or protocol (Q&A)
- Edit the protocol when the user requests changes

Current protocol:
{req.protocol_text}

Current risk flags:
{risk_context}

When answering questions: be concise, practical, and grounded in the risk flags above.
When editing the protocol: make the requested change, return the full updated protocol text.

Return ONLY valid JSON:
For Q&A: {{"type": "answer", "content": "your response"}}
For edits: {{"type": "protocol_update", "updated_protocol": "full updated protocol text", "content": "what you changed and why"}}
"""

        messages = req.conversation_history + [{"role": "user", "content": req.message}]

        response = get_anthropic().messages.create(
            model="claude-opus-4-5", max_tokens=1000, system=system, messages=messages
        )

        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()

        result = json.loads(raw)

        if result["type"] == "protocol_update" and req.experiment_id:
            from supabase import create_client

            sb = create_client(
                os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY")
            )
            sb.table("experiments").update(
                {"design_text": result["updated_protocol"]}
            ).eq("id", req.experiment_id).execute()

        return result

    except json.JSONDecodeError:
        return {
            "type": "answer",
            "content": "Sorry, I couldn't process that. Please try again.",
        }
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Risk chat error: {str(e)}")


# ── Risk report PDF export ───────────────────────────────────


class RiskExportRequest(BaseModel):
    experiment_description: str
    risk_items: list[dict]


@router.post("/risk/export-pdf")
async def export_risk_pdf(req: RiskExportRequest):
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib import colors
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.platypus import (
            SimpleDocTemplate,
            Paragraph,
            Spacer,
            Table,
            TableStyle,
        )
        import datetime

        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
        doc = SimpleDocTemplate(
            tmp.name, pagesize=letter, topMargin=40, bottomMargin=40
        )
        styles = getSampleStyleSheet()
        story = []

        title_style = ParagraphStyle(
            "title", parent=styles["Heading1"], fontSize=20, spaceAfter=4
        )
        story.append(Paragraph("Risk Analysis Report", title_style))

        meta_style = ParagraphStyle(
            "meta",
            parent=styles["Normal"],
            fontSize=10,
            textColor=colors.gray,
            spaceAfter=16,
        )
        story.append(
            Paragraph(
                f"Generated: {datetime.datetime.now().strftime('%B %d, %Y')}",
                meta_style,
            )
        )
        story.append(Spacer(1, 8))

        story.append(Paragraph("Protocol Summary", styles["Heading2"]))
        body_style = ParagraphStyle(
            "body", parent=styles["Normal"], fontSize=10, spaceAfter=12
        )
        story.append(Paragraph(req.experiment_description[:1000], body_style))
        story.append(Spacer(1, 16))

        severity_colors = {
            "high": colors.HexColor("#dc2626"),
            "medium": colors.HexColor("#d97706"),
            "suggestion": colors.HexColor("#6b7280"),
        }

        severity_labels = {
            "high": "🔴 HIGH",
            "medium": "🟡 MEDIUM",
            "suggestion": "⚪ SUGGESTION",
        }

        story.append(Paragraph("Risk Flags", styles["Heading2"]))
        story.append(Spacer(1, 8))

        for i, item in enumerate(req.risk_items):
            severity = item.get("severity", "medium")
            color = severity_colors.get(severity, colors.gray)

            severity_style = ParagraphStyle(
                "sev",
                parent=styles["Normal"],
                fontSize=9,
                fontName="Helvetica-Bold",
                textColor=color,
                spaceAfter=2,
            )
            story.append(Paragraph(severity_labels.get(severity, ""), severity_style))

            risk_style = ParagraphStyle(
                "risk",
                parent=styles["Normal"],
                fontSize=11,
                fontName="Helvetica-Bold",
                spaceAfter=4,
            )
            story.append(Paragraph(f"{i + 1}. {item['risk']}", risk_style))
            story.append(Paragraph(item.get("explanation", ""), body_style))

            suggestion_data = [
                [
                    Paragraph(
                        "Suggestion",
                        ParagraphStyle(
                            "sh",
                            parent=styles["Normal"],
                            fontSize=9,
                            fontName="Helvetica-Bold",
                        ),
                    ),
                    Paragraph(
                        item.get("suggestion", ""),
                        ParagraphStyle("sb", parent=styles["Normal"], fontSize=9),
                    ),
                ]
            ]
            suggestion_table = Table(suggestion_data, colWidths=[80, 380])
            suggestion_table.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f9fafb")),
                        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e7eb")),
                        ("TOPPADDING", (0, 0), (-1, -1), 8),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                        ("LEFTPADDING", (0, 0), (-1, -1), 10),
                    ]
                )
            )
            story.append(suggestion_table)
            story.append(Spacer(1, 8))

            sources = item.get("sources", [])
            if sources:
                source_style = ParagraphStyle(
                    "src",
                    parent=styles["Normal"],
                    fontSize=8,
                    textColor=colors.gray,
                    spaceAfter=4,
                )
                story.append(Paragraph("Sources:", source_style))
                for s in sources:
                    doi_text = f" · doi.org/{s['doi']}" if s.get("doi") else ""
                    story.append(
                        Paragraph(
                            f"• {s.get('title', '')} ({s.get('year', '')}){doi_text}",
                            source_style,
                        )
                    )

            story.append(Spacer(1, 20))

        doc.build(story)
        return FileResponse(
            tmp.name, media_type="application/pdf", filename="risk_analysis_report.pdf"
        )

    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"PDF export error: {str(e)}")
