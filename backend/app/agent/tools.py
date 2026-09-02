"""
Agent Tools
DuckDuckGo web search, calculator, Python REPL, Wikipedia, weather, custom API.
"""

import math
import httpx
from langchain_core.tools import tool
from langchain_community.tools import DuckDuckGoSearchRun
from langchain_community.utilities import WikipediaAPIWrapper
from app.core.config import settings


# === Web Search ===
def make_search_tool():
    return DuckDuckGoSearchRun()


# === Calculator ===
@tool
def calculator(expression: str) -> str:
    """
    Evaluate a mathematical expression. Supports +, -, *, /, **, sqrt, sin, cos, etc.
    Example: '2 ** 10', 'sqrt(144)', '(3 + 4) * 2'
    """
    try:
        # Safe eval using math module namespace only
        allowed = {k: getattr(math, k) for k in dir(math) if not k.startswith("_")}
        allowed["abs"] = abs
        allowed["round"] = round
        result = eval(expression, {"__builtins__": {}}, allowed)  # noqa: S307
        return str(result)
    except Exception as e:
        return f"Error evaluating expression: {e}"


# === Python REPL ===
@tool
def python_repl(code: str) -> str:
    """
    Execute a Python code snippet and return stdout output.
    Useful for data manipulation, formatting, and calculations.
    Example: 'print([x**2 for x in range(10)])'
    """
    import io
    import contextlib

    output = io.StringIO()
    try:
        with contextlib.redirect_stdout(output):
            exec(code, {"__builtins__": __builtins__})  # noqa: S102
        return output.getvalue() or "Code executed successfully (no output)."
    except Exception as e:
        return f"Error: {e}"


# === Wikipedia ===
@tool
def wikipedia_search(query: str) -> str:
    """
    Look up a topic on Wikipedia. Returns a summary.
    Example: 'Python programming language', 'Eiffel Tower'
    """
    try:
        wiki = WikipediaAPIWrapper(top_k_results=2, doc_content_chars_max=1500)
        return wiki.run(query)
    except Exception as e:
        return f"Wikipedia error: {e}"


# === Weather ===
@tool
def get_weather(city: str) -> str:
    """
    Get current weather conditions for a city.
    Example: 'London', 'New York', 'Tokyo'
    """
    api_key = settings.OPENWEATHER_API_KEY
    if not api_key:
        return "Weather tool unavailable: OPENWEATHER_API_KEY not configured."
    try:
        url = "https://api.openweathermap.org/data/2.5/weather"
        resp = httpx.get(url, params={"q": city, "appid": api_key, "units": "metric"}, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        desc = data["weather"][0]["description"].capitalize()
        temp = data["main"]["temp"]
        feels = data["main"]["feels_like"]
        humidity = data["main"]["humidity"]
        return f"{city}: {desc}, {temp}°C (feels like {feels}°C), humidity {humidity}%"
    except httpx.HTTPStatusError as e:
        return f"Weather API error: {e.response.status_code}"
    except Exception as e:
        return f"Weather error: {e}"


# === Custom API ===
@tool
def call_api(url: str, method: str = "GET", payload: str = "") -> str:
    """
    Make an HTTP request to any API endpoint.
    Args:
        url: Full URL to call (e.g. 'https://api.example.com/data')
        method: HTTP method — GET or POST (default: GET)
        payload: JSON string body for POST requests (optional)
    """
    try:
        headers = {"Content-Type": "application/json"}
        if method.upper() == "POST":
            resp = httpx.post(url, content=payload, headers=headers, timeout=15)
        else:
            resp = httpx.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        text = resp.text[:2000]  # cap response size
        return text
    except httpx.HTTPStatusError as e:
        return f"API error {e.response.status_code}: {e.response.text[:500]}"
    except Exception as e:
        return f"Request error: {e}"


def get_all_tools() -> list:
    tools = [make_search_tool(), calculator, python_repl, wikipedia_search, get_weather, call_api]
    return tools
