from langchain_community.embeddings import DeterministicFakeEmbedding

def get_embeddings():
    # Lightweight fake embeddings — RAG disabled in production to save memory
    # Replace with a real embedding service when needed
    return DeterministicFakeEmbedding(size=384)
