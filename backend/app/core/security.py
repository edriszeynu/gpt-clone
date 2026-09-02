"""
Auth & Security — JWT + bcrypt + SQLite user store.
"""

from datetime import datetime, timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db, UserModel

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def get_user_by_username(username: str, db: Session) -> UserModel | None:
    return db.query(UserModel).filter(UserModel.username == username).first()


def get_user_by_email(email: str, db: Session) -> UserModel | None:
    return db.query(UserModel).filter(UserModel.email == email).first()


def get_user_by_oauth(provider: str, oauth_id: str, db: Session) -> UserModel | None:
    return db.query(UserModel).filter(
        UserModel.oauth_provider == provider,
        UserModel.oauth_id == oauth_id,
    ).first()


def register_user(username: str, password: str, db: Session, email: str = None) -> bool:
    if get_user_by_username(username, db):
        return False
    if email and get_user_by_email(email, db):
        return False
    user = UserModel(
        username=username,
        email=email,
        hashed_password=hash_password(password),
    )
    db.add(user)
    db.commit()
    return True


def upsert_oauth_user(provider: str, oauth_id: str, email: str, username: str, db: Session) -> UserModel:
    """Find or create a user from an OAuth login."""
    user = get_user_by_oauth(provider, oauth_id, db)
    if user:
        return user
    # Check if email already exists (link accounts)
    user = get_user_by_email(email, db) if email else None
    if user:
        user.oauth_provider = provider
        user.oauth_id = oauth_id
        db.commit()
        return user
    # Create new user
    base = username.lower().replace(" ", "_") or provider
    final_username = base
    counter = 1
    while get_user_by_username(final_username, db):
        final_username = f"{base}{counter}"
        counter += 1
    user = UserModel(
        username=final_username,
        email=email,
        hashed_password=None,
        oauth_provider=provider,
        oauth_id=oauth_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate_user(identifier: str, password: str, db: Session) -> UserModel | None:
    """Login with username or email."""
    user = get_user_by_username(identifier, db) or get_user_by_email(identifier, db)
    if not user or not user.hashed_password:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


def create_access_token(data: dict, expires_delta: timedelta = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> UserModel:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        username: str = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = get_user_by_username(username, db)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user
