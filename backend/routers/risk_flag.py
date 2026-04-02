from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from anthropic import Anthropic
from dotenv import load_dotenv
import os
import json
import requests
import xmltodict
import asyncio
from concurrent.futures import ThreadPoolExecutor

load_dotenv()

router = APIRouter()
executor = ThreadPoolExecutor(max_workers=4)

def get_anthropic():
    return Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


# ── Step 1: Extract search queries ──────────────────────────

def extract_search_queries(experiment_description: str) -> list[str]:
    response = get_anthropic().messages.create(
        model="claude-opus-4-5",
        max_tokens=300,
        messages=[{
            "role": "user",
            "content": f"""From this experiment description, extract 3-5 specific search queries
for finding relevant scientific literature about potential risks and best practices.
Focus on: experimental method, key parameters, materials, safety-critical steps.
Return ONLY a JSON array of strings. No explanation, no markdown.

Experiment: {experiment_description}"""
        }]
    )
    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    return json.loads(raw)


# ── Step 2a: Semantic Scholar ────────────────────────────────

def search_semantic_scholar(query: str, limit: int = 5) -> list[dict]:
    try:
        url = "https://api.semanticscholar.org/graph/v1/paper/search"
        params = {
            "query": query,
            "limit": limit,
            "fields": "title,abstract,authors,year,externalIds,openAccessPdf"
        }
        headers = {}
        api_key = os.getenv("SEMANTIC_SCHOLAR_API_KEY")
        if api_key:
            headers["x-api-key"] = api_key

        res = requests.get(url, params=params, headers=headers, timeout=10)
        papers = res.json().get("data", [])

        return [{
            "title": p.get("title", ""),
            "abstract": p.get("abstract", ""),
            "year": p.get("year", ""),
            "doi": p.get("externalIds", {}).get("DOI", ""),
            "source": "Semantic Scholar"
        } for p in papers if p.get("abstract")]

    except Exception as e:
        print(f"[risk_flag] Semantic Scholar error: {e}")
        return []


# ── Step 2b: PubMed ──────────────────────────────────────────

def search_pubmed(query: str, limit: int = 5) -> list[dict]:
    try:
        # Step 1: get PMIDs
        search_res = requests.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
            params={"db": "pubmed", "term": query, "retmax": limit, "retmode": "json"},
            timeout=10
        ).json()
        pmids = search_res["esearchresult"]["idlist"]
        if not pmids:
            return []

        # Step 2: fetch abstracts as XML
        fetch_res = requests.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi",
            params={"db": "pubmed", "id": ",".join(pmids), "retmode": "xml"},
            timeout=10
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

                # Extract abstract
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

                # Extract DOI
                doi = ""
                id_list = article.get("PubmedData", {}).get("ArticleIdList", {}).get("ArticleId", [])
                if isinstance(id_list, dict):
                    id_list = [id_list]
                for id_item in id_list:
                    if isinstance(id_item, dict) and id_item.get("@IdType") == "doi":
                        doi = id_item.get("#text", "")

                year = medline.get("DateCompleted", {}).get("Year", "")

                if abstract:
                    papers.append({
                        "title": title,
                        "abstract": abstract,
                        "year": year,
                        "doi": doi,
                        "source": "PubMed"
                    })
            except Exception:
                continue

        return papers

    except Exception as e:
        print(f"[risk_flag] PubMed error: {e}")
        return []


# ── Step 3-5: RAG prompt + structured output ─────────────────

def generate_risk_flags(experiment_description: str) -> dict:
    print("[risk_flag] extracting search queries...")
    queries = extract_search_queries(experiment_description)
    print(f"[risk_flag] queries: {queries}")

    # Retrieve papers in parallel
    all_papers = []
    with ThreadPoolExecutor(max_workers=6) as ex:
        ss_futures = [ex.submit(search_semantic_scholar, q, 4) for q in queries]
        pm_futures = [ex.submit(search_pubmed, q, 3) for q in queries]
        for f in ss_futures + pm_futures:
            all_papers.extend(f.result())

    # Deduplicate by DOI, keep up to 15
    seen = set()
    papers = []
    for p in all_papers:
        key = p["doi"] or p["title"]
        if key and key not in seen and len(papers) < 15:
            seen.add(key)
            papers.append(p)

    print(f"[risk_flag] retrieved {len(papers)} unique papers")

    if not papers:
        return {"risk_items": [], "papers_retrieved": 0, "warning": "No papers retrieved — check API connectivity"}

    # Build literature context
    literature_context = ""
    for i, p in enumerate(papers):
        literature_context += f"""
[{i+1}] {p['title']} ({p['year']}) — {p['source']}
DOI: {p['doi'] or 'N/A'}
Abstract: {p['abstract'][:600]}
"""

    prompt = f"""You are reviewing an experiment design for a junior researcher (undergraduate or early PhD student).
Identify 3-5 specific risks or important considerations they may not be aware of.

EXPERIMENT DESCRIPTION:
{experiment_description}

RETRIEVED LITERATURE (use ONLY these sources):
{literature_context}

Rules:
- Base ALL suggestions strictly on the literature provided above
- Every risk item MUST cite at least one paper from the list above by its bracket number
- Do NOT add risks from general knowledge without a citation from the list
- Do NOT hallucinate papers — only cite papers in the list above
- Tone: collegial and practical, not alarming
- Focus on what a junior researcher might overlook

Return ONLY a JSON array, no markdown, no explanation:
[{{
  "risk": "Short title (5-8 words)",
  "explanation": "Why this matters for this specific experiment (1-2 sentences)",
  "suggestion": "Concrete thing to check or adjust (1-2 sentences)",
  "citation_indices": [1, 3]
}}]"""

    response = get_anthropic().messages.create(
        model="claude-opus-4-5",
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}]
    )

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()

    risk_items = json.loads(raw)

    # Resolve citation indices to real paper metadata
    for item in risk_items:
        item["sources"] = [
            {
                "title": papers[i-1]["title"],
                "year": papers[i-1]["year"],
                "doi": papers[i-1]["doi"],
                "url": f"https://doi.org/{papers[i-1]['doi']}" if papers[i-1]["doi"] else None,
                "source": papers[i-1]["source"]
            }
            for i in item.get("citation_indices", [])
            if 0 < i <= len(papers)
        ]
        del item["citation_indices"]

    return {
        "risk_items": risk_items,
        "papers_retrieved": len(papers)
    }


# ── Endpoint ─────────────────────────────────────────────────

class RiskFlagRequest(BaseModel):
    experiment_description: str
    experiment_id: str | None = None

@router.post("/analyze-experiment-design")
async def analyze_experiment_design(req: RiskFlagRequest):
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            executor,
            generate_risk_flags,
            req.experiment_description
        )

        # Save feedback to DB if experiment_id provided
        if req.experiment_id and result["risk_items"]:
            from supabase import create_client
            sb = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY"))
            sb.table("experiments").update({
                "design_feedback": json.dumps(result["risk_items"])
            }).eq("id", req.experiment_id).execute()

        return result

    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Claude returned invalid JSON: {str(e)}")
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Risk flag error: {str(e)}")
    
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
2. Risk flags that were identified from scientific literature

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

        messages = req.conversation_history + [
            {"role": "user", "content": req.message}
        ]

        response = get_anthropic().messages.create(
            model="claude-opus-4-5",
            max_tokens=1000,
            system=system,
            messages=messages
        )

        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()

        result = json.loads(raw)

        # If protocol was updated, save to DB
        if result["type"] == "protocol_update" and req.experiment_id:
            from supabase import create_client
            sb = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY"))
            sb.table("experiments").update({
                "design_text": result["updated_protocol"]
            }).eq("id", req.experiment_id).execute()

        return result

    except json.JSONDecodeError:
        return {"type": "answer", "content": "Sorry, I couldn't process that. Please try again."}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Risk chat error: {str(e)}")