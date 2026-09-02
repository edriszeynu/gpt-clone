"""
Thread Memory Store — Redis-backed, persistent across restarts.
Falls back to in-memory if Redis is unavailable.
"""

import json
import redis as redis_lib
from langchain_core.messages import HumanMessage, AIMessage, BaseMessage
from app.core.config import settings

# Max messages stored per thread
MAX_MESSAGES = 20
TTL_SECONDS = 60 * 60 * 24 * 7  # 7 days


def _serialize(msg: BaseMessage) -> str:
    return json.dumps({"type": msg.__class__.__name__, "content": msg.content})


def _deserialize(raw: str) -> BaseMessage:
    data = json.loads(raw)
    return HumanMessage(content=data["content"]) if data["type"] == "HumanMessage" else AIMessage(content=data["content"])


class RedisThreadStore:
    def __init__(self):
        try:
            self._redis = redis_lib.from_url(settings.REDIS_URL, decode_responses=True)
            self._redis.ping()
            self._available = True
            print("Thread store: Redis connected")
        except Exception:
            self._redis = None
            self._available = False
            self._fallback: dict[str, list] = {}
            print("Thread store: Redis unavailable, using in-memory fallback")

    def _key(self, thread_id: str) -> str:
        return f"thread:{thread_id}"

    def get(self, thread_id: str) -> list[BaseMessage]:
        if self._available:
            raw = self._redis.lrange(self._key(thread_id), 0, -1)
            return [_deserialize(r) for r in raw]
        return list(self._fallback.get(thread_id, []))

    def add(self, thread_id: str, messages: list[BaseMessage]) -> None:
        if self._available:
            key = self._key(thread_id)
            pipe = self._redis.pipeline()
            for msg in messages:
                pipe.rpush(key, _serialize(msg))
            # Trim to max length and reset TTL
            pipe.ltrim(key, -MAX_MESSAGES, -1)
            pipe.expire(key, TTL_SECONDS)
            pipe.execute()
        else:
            existing = self._fallback.setdefault(thread_id, [])
            existing.extend(messages)
            if len(existing) > MAX_MESSAGES:
                self._fallback[thread_id] = existing[-MAX_MESSAGES:]

    def clear(self, thread_id: str) -> None:
        if self._available:
            self._redis.delete(self._key(thread_id))
        else:
            self._fallback.pop(thread_id, None)

    def list_threads(self) -> list[str]:
        if self._available:
            keys = self._redis.keys("thread:*")
            return [k.replace("thread:", "") for k in keys]
        return list(self._fallback.keys())


thread_store = RedisThreadStore()
