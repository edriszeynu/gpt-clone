"""
LangGraph ReAct Agent — supports invoke and streaming with conversation history.
"""

import os
import json
from typing import AsyncIterator
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, BaseMessage
from langgraph.prebuilt import create_react_agent

from app.core.config import settings
from app.agent.tools import get_all_tools


def _make_llm(model: str) -> ChatOpenAI:
    return ChatOpenAI(
        model=model,
        temperature=0,
        timeout=60,
        max_retries=0,
        api_key=settings.OPENROUTER_API_KEY,
        base_url=settings.OPENROUTER_BASE_URL,
    )


class ProductionAgent:
    def __init__(self):
        self.tools = get_all_tools()
        self._primary = create_react_agent(_make_llm(settings.PRIMARY_MODEL), self.tools)
        self._fallback = create_react_agent(_make_llm(settings.FALLBACK_MODEL), self.tools)

    def invoke(self, message: str, history: list = None) -> dict:
        history = history or []
        input_state = {"messages": history + [HumanMessage(content=message)]}
        last_error = "Unknown error"

        for agent, label in [(self._primary, "primary"), (self._fallback, "fallback")]:
            try:
                result = agent.invoke(input_state)
                new_messages = result["messages"][len(history):]
                return {
                    "response": result["messages"][-1].content,
                    "model_used": label,
                    "new_messages": new_messages,
                    "error": None,
                }
            except Exception as e:
                print(f"{label.upper()} EXCEPTION: {e}")
                last_error = str(e)

        return {
            "response": "I'm sorry, I'm having trouble processing your request right now.",
            "model_used": "error_handler",
            "new_messages": [],
            "error": last_error,
        }

    async def stream(self, message: str, history: list = None, think: bool = False,
                     model: str = "", system_prompt: str = ""):
        history = history or []
        if think:
            message = (
                "Think through this carefully and reason step by step before giving your final answer.\n\n"
                + message
            )
        # Prepend system prompt as a human->ai exchange so it guides the agent
        if system_prompt:
            from langchain_core.messages import SystemMessage
            input_messages = [SystemMessage(content=system_prompt)] + history + [HumanMessage(content=message)]
        else:
            input_messages = history + [HumanMessage(content=message)]

        input_state = {"messages": input_messages}

        # Use custom model if specified
        agent = self._primary
        if model and model != settings.PRIMARY_MODEL:
            try:
                agent = create_react_agent(_make_llm(model), self.tools)
            except Exception:
                agent = self._primary

        tools_used: list[str] = []
        try:
            async for event in agent.astream_events(input_state, version="v2"):
                if event["event"] == "on_tool_start":
                    tool_name = event.get("name", "tool")
                    if tool_name not in tools_used:
                        tools_used.append(tool_name)
                    yield {"type": "tool_start", "tool": tool_name}
                elif (
                    event["event"] == "on_chat_model_stream"
                    and event.get("metadata", {}).get("langgraph_node") == "agent"
                ):
                    chunk = event["data"]["chunk"]
                    if chunk.content:
                        yield {"type": "chunk", "content": chunk.content}

            source = "tools" if tools_used else "llm"
            yield {"type": "meta", "source": source, "tools_used": tools_used}

        except Exception as e:
            print(f"STREAM EXCEPTION: {e}")
            yield {"type": "chunk", "content": "I'm sorry, I'm having trouble processing your request right now."}
            yield {"type": "meta", "source": "llm", "tools_used": []}
