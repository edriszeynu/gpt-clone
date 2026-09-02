import time
import tempfile
import os
import json
import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import StreamingResponse, RedirectResponse
from langchain_core.messages import HumanMessage, AIMessage
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.models.api_models import ChatRequest, ChatResponse, HealthResponse, MetricsResponse
from app.core.security import (
    get_current_user, authenticate_user, create_access_token,
    register_user, upsert_oauth_user,
)
from app.core.security_pipeline import SecurityPipeline
from app.core.response_cache import ResponseCache
from app.core.thread_store import thread_store
from app.core.database import get_db, UserModel
from app.core.config import settings
from app.rag.retriever import retriever
from app.rag.ingest import ingest_document
from app.agent.production_agent import ProductionAgent

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

security_pipeline = SecurityPipeline()
cache = ResponseCache(ttl_seconds=3600)
agent = ProductionAgent()


# === Auth Models ===
class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str

class LoginRequest(BaseModel):
    email: str        # accepts email or username
    password: str


# === Auth Routes ===
@router.post("/auth/register")
@limiter.limit("5/minute")
async def register(request: Request, body: RegisterRequest, db: Session = Depends(get_db)):
    success = register_user(body.username, body.password, db, email=body.email)
    if not success:
        raise HTTPException(status_code=409, detail="Username or email already taken")
    token = create_access_token(data={"sub": body.username})
    return {"access_token": token, "token_type": "bearer", "username": body.username}


@router.post("/auth/login")
@limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest, db: Session = Depends(get_db)):
    user = authenticate_user(body.email, body.password, db)
    if not user:
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    token = create_access_token(data={"sub": user.username})
    return {"access_token": token, "token_type": "bearer", "username": user.username}


# === GitHub OAuth ===
@router.get("/auth/github")
async def github_login():
    if not settings.GITHUB_CLIENT_ID:
        raise HTTPException(status_code=501, detail="GitHub OAuth not configured")
    callback = f"{settings.BACKEND_URL}/auth/github/callback"
    url = (
        f"https://github.com/login/oauth/authorize"
        f"?client_id={settings.GITHUB_CLIENT_ID}"
        f"&scope=user:email"
        f"&redirect_uri={callback}"
    )
    return RedirectResponse(url)


@router.get("/auth/github/callback")
async def github_callback(code: str, db: Session = Depends(get_db)):
    if not settings.GITHUB_CLIENT_ID:
        raise HTTPException(status_code=501, detail="GitHub OAuth not configured")
    callback = f"{settings.BACKEND_URL}/auth/github/callback"
    async with httpx.AsyncClient() as client:
        token_res = await client.post(
            "https://github.com/login/oauth/access_token",
            json={"client_id": settings.GITHUB_CLIENT_ID, "client_secret": settings.GITHUB_CLIENT_SECRET, "code": code},
            headers={"Accept": "application/json"},
        )
        token_data = token_res.json()
        access_token = token_data.get("access_token")
        if not access_token:
            raise HTTPException(status_code=400, detail=f"GitHub auth failed: {token_data}")

        user_res = await client.get("https://api.github.com/user", headers={"Authorization": f"Bearer {access_token}"})
        gh_user = user_res.json()

        email_res = await client.get("https://api.github.com/user/emails", headers={"Authorization": f"Bearer {access_token}"})
        emails = email_res.json()
        primary_email = next((e["email"] for e in emails if e.get("primary")), gh_user.get("email", ""))

    user = upsert_oauth_user("github", str(gh_user["id"]), primary_email, gh_user.get("login", ""), db)
    jwt_token = create_access_token(data={"sub": user.username})
    return RedirectResponse(f"{settings.FRONTEND_URL}/chat?token={jwt_token}&username={user.username}")


# === Google OAuth ===
@router.get("/auth/google")
async def google_login():
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=501, detail="Google OAuth not configured")
    callback = f"{settings.BACKEND_URL}/auth/google/callback"
    url = (
        f"https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={settings.GOOGLE_CLIENT_ID}"
        f"&redirect_uri={callback}"
        f"&response_type=code"
        f"&scope=openid email profile"
    )
    return RedirectResponse(url)


@router.get("/auth/google/callback")
async def google_callback(code: str, db: Session = Depends(get_db)):
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=501, detail="Google OAuth not configured")
    callback = f"{settings.BACKEND_URL}/auth/google/callback"
    async with httpx.AsyncClient() as client:
        token_res = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": callback,
                "grant_type": "authorization_code",
            },
        )
        token_data = token_res.json()
        access_token = token_data.get("access_token")
        if not access_token:
            raise HTTPException(status_code=400, detail=f"Google auth failed: {token_data}")

        user_res = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        g_user = user_res.json()

    user = upsert_oauth_user("google", g_user["id"], g_user.get("email", ""), g_user.get("name", ""), db)
    jwt_token = create_access_token(data={"sub": user.username})
    return RedirectResponse(f"{settings.FRONTEND_URL}/chat?token={jwt_token}&username={user.username}")



# === Chat (standard) ===
@router.post("/chat", response_model=ChatResponse)
@limiter.limit("30/minute")
async def chat(
    request: Request,
    body: ChatRequest,
    user: UserModel = Depends(get_current_user),
):
    start_time = time.time()
    thread_id = body.thread_id
    user_message = body.message

    is_allowed, cleaned_message, security_notes = security_pipeline.check_input(user_message)
    if not is_allowed:
        raise HTTPException(status_code=400, detail=security_notes[0] if security_notes else "Input blocked")

    docs = retriever.invoke(cleaned_message)
    context = "\n".join([doc.page_content for doc in docs]) if docs else ""
    final_message = (
        f"[Reference documents — use only if relevant, do NOT infer personal details about the user from these]\n{context}\n\n{cleaned_message}"
        if context else cleaned_message
    )

    history = thread_store.get(thread_id)
    cached_response = cache.get(cleaned_message) if not history else None

    if cached_response is not None:
        response_text = cached_response
        model_used = "cache"
    else:
        result = agent.invoke(final_message, history=history)
        response_text = result["response"]
        model_used = result["model_used"]
        # Store clean user message + AI response so history stays coherent
        if response_text:
            thread_store.add(thread_id, [
                HumanMessage(content=cleaned_message),
                AIMessage(content=response_text),
            ])
        if not history:
            cache.set(cleaned_message, response_text)

    validated_response, output_warnings = security_pipeline.check_output(response_text)
    if output_warnings and "Harmful content blocked" in output_warnings[0]:
        validated_response = "I'm sorry, I cannot provide that information."

    return ChatResponse(
        response=validated_response,
        thread_id=thread_id,
        model_used=model_used,
        cached=cached_response is not None,
        processing_time_ms=(time.time() - start_time) * 1000,
        security_notes=security_notes + output_warnings,
    )


# === Chat (streaming) ===
@router.post("/chat/stream")
@limiter.limit("30/minute")
async def chat_stream(
    request: Request,
    body: ChatRequest,
    user: UserModel = Depends(get_current_user),
):
    is_allowed, cleaned_message, _ = security_pipeline.check_input(body.message)
    if not is_allowed:
        raise HTTPException(status_code=400, detail="Input blocked")

    docs = retriever.invoke(cleaned_message)
    context = "\n".join([doc.page_content for doc in docs]) if docs else ""
    final_message = (
        f"[Reference documents — use only if relevant, do NOT infer personal details about the user from these]\n{context}\n\n{cleaned_message}"
        if context else cleaned_message
    )

    history = thread_store.get(body.thread_id)
    thread_id = body.thread_id

    async def event_generator():
        full_chunks: list[str] = []
        tools_used: list[str] = []
        source = "llm"

        async for event in agent.stream(final_message, history=history, think=body.think,
                                        model=body.model, system_prompt=body.system_prompt):
            if event["type"] == "chunk":
                full_chunks.append(event["content"])
                yield f"data: {json.dumps({'chunk': event['content']})}\n\n"
            elif event["type"] == "tool_start":
                tools_used.append(event["tool"])
                yield f"data: {json.dumps({'tool_start': event['tool']})}\n\n"
            elif event["type"] == "meta":
                source = event["source"]
                tools_used = event["tools_used"]

        full_response = "".join(full_chunks)
        if full_response:
            thread_store.add(thread_id, [
                HumanMessage(content=cleaned_message),
                AIMessage(content=full_response),
            ])

        # Send final metadata so frontend knows what was used
        yield f"data: {json.dumps({'meta': {'source': source, 'tools_used': tools_used}})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# === Thread Management ===
@router.get("/threads")
async def list_threads(user: UserModel = Depends(get_current_user)):
    return {"threads": thread_store.list_threads()}


@router.delete("/threads/{thread_id}")
async def clear_thread(thread_id: str, user: UserModel = Depends(get_current_user)):
    thread_store.clear(thread_id)
    return {"message": f"Thread '{thread_id}' cleared"}


@router.get("/threads/{thread_id}/export")
async def export_thread(thread_id: str, user: UserModel = Depends(get_current_user)):
    """Export conversation as markdown."""
    messages = thread_store.get(thread_id)
    lines = [f"# Conversation Export\n\n"]
    for msg in messages:
        role = "**You**" if msg.__class__.__name__ == "HumanMessage" else "**EdrisGPT**"
        lines.append(f"{role}\n\n{msg.content}\n\n---\n\n")
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse("".join(lines), media_type="text/markdown",
                             headers={"Content-Disposition": f'attachment; filename="chat-{thread_id}.md"'})


# === Document Upload ===
@router.post("/upload")
@limiter.limit("10/minute")
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    user: UserModel = Depends(get_current_user),
):
    with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1]) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    try:
        ingest_document(tmp_path)
    finally:
        os.unlink(tmp_path)
    return {"message": "Document ingested"}


# === Health & Metrics ===
@router.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="healthy",
        environment="development",
        checks={"cache": "ok", "vector_store": "ok"},
    )


@router.get("/metrics", response_model=MetricsResponse)
async def metrics(user: UserModel = Depends(get_current_user)):
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
