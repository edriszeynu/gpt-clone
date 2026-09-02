import time
import tempfile
import os
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from app.models.api_models import ChatRequest, ChatResponse, HealthResponse, MetricsResponse
from app.core.security import get_current_user, authenticate_user, create_access_token
from app.core.security_pipeline import SecurityPipeline
from app.core.response_cache import ResponseCache
from app.rag.retriever import retriever
from app.rag.ingest import ingest_document
from app.agent.production_agent import ProductionAgent

router = APIRouter()

security_pipeline = SecurityPipeline()
cache = ResponseCache(ttl_seconds=3600)
agent = ProductionAgent()

@router.post("/auth/login")
async def login(username: str, password: str):
    user = authenticate_user(username, password)
    if not user:
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    token = create_access_token(data={"sub": username})
    return {"access_token": token, "token_type": "bearer"}

@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, user=Depends(get_current_user)):
    start_time = time.time()
    thread_id = request.thread_id
    user_message = request.message

    is_allowed, cleaned_message, security_notes = security_pipeline.check_input(user_message)
    if not is_allowed:
        raise HTTPException(status_code=400, detail=security_notes[0] if security_notes else "Input blocked")

    docs = retriever.get_relevant_documents(cleaned_message)
    context = "\n".join([doc.page_content for doc in docs]) if docs else ""

    system_prompt = f"Use the following context to answer the user's question:\n{context}" if context else ""
    final_message = f"{system_prompt}\n\nUser: {cleaned_message}" if system_prompt else cleaned_message

    cached_response = cache.get(cleaned_message)
    if cached_response is not None:
        response_text = cached_response
        model_used = "cache"
        cached = True
    else:
        result = agent.invoke(final_message)
        response_text = result["response"]
        model_used = result["model_used"]
        cached = False
        cache.set(cleaned_message, response_text)

    validated_response, output_warnings = security_pipeline.check_output(response_text)
    if output_warnings and "Harmful content blocked" in output_warnings[0]:
        validated_response = "I'm sorry, I cannot provide that information."

    processing_time = (time.time() - start_time) * 1000
    return ChatResponse(
        response=validated_response,
        thread_id=thread_id,
        model_used=model_used,
        cached=cached,
        processing_time_ms=processing_time,
        security_notes=security_notes + output_warnings,
    )

@router.post("/upload")
async def upload_document(file: UploadFile = File(...), user=Depends(get_current_user)):
    with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1]) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name
    try:
        ingest_document(tmp_path)
    finally:
        os.unlink(tmp_path)
    return {"message": "Document ingested"}

@router.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="healthy",
        environment="development",
        checks={"cache": "ok", "vector_store": "ok"}
    )

@router.get("/metrics", response_model=MetricsResponse)
async def metrics(user=Depends(get_current_user)):
    stats = cache.stats
    return MetricsResponse(
        total_requests=0,
        total_errors=0,
        error_rate="0%",
        avg_latency_ms=0.0,
        cache_hit_rate=stats["hit_rate"],
        total_input_tokens=0,
        total_output_tokens=0,
    )