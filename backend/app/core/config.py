from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"
    TAVILY_API_KEY: str = ""
    OPENWEATHER_API_KEY: str = ""
    REDIS_URL: str = "redis://localhost:6379"
    VECTOR_STORE_PATH: str = "./chroma_db"
    JWT_SECRET: str = "change-this-to-a-strong-secret"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    PRIMARY_MODEL: str = "openai/gpt-oss-20b"
    FALLBACK_MODEL: str = "openai/gpt-oss-20b"
    MAX_RETRIES: int = 1
    # OAuth
    GITHUB_CLIENT_ID: str = ""
    GITHUB_CLIENT_SECRET: str = ""
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    FRONTEND_URL: str = "http://localhost:3000"
    BACKEND_URL: str = "http://localhost:8000/api"

    class Config:
        env_file = ".env"

settings = Settings()
