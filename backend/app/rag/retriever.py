from langchain_chroma import Chroma
from app.rag.embeddings import get_embeddings
from app.core.config import settings

embeddings = get_embeddings()
vectorstore = Chroma(
    persist_directory=settings.VECTOR_STORE_PATH,
    embedding_function=embeddings,
)

# Use similarity score threshold so low-relevance docs are not injected
retriever = vectorstore.as_retriever(
    search_type="similarity_score_threshold",
    search_kwargs={"k": 4, "score_threshold": 0.5},
)