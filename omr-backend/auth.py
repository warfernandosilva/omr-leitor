import os
from datetime import datetime, timedelta

from jose import JWTError, jwt
import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
import models

def _get_secret_key() -> str:
    key = os.environ.get("JWT_SECRET", "")
    if not key:
        if os.environ.get("OMR_ENV", "development") == "production":
            raise RuntimeError("JWT_SECRET é obrigatório em produção (defina env JWT_SECRET)")
        # dev fallback — gera aviso visível
        import warnings
        warnings.warn("JWT_SECRET não definido — usando chave dev insegura. Defina JWT_SECRET em produção.", UserWarning)
        return "dev-secret-change-me-please-use-env-var"
    if len(key) < 32:
        import warnings
        warnings.warn("JWT_SECRET muito curto (<32 chars) — use uma chave mais forte.", UserWarning)
    return key

SECRET_KEY = _get_secret_key()
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 72

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> models.User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido ou expirado",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str | None = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.scalar(select(models.User).where(models.User.email == email))
    if user is None or not user.is_active:
        raise credentials_exception
    return user


async def get_current_active_user(current_user: models.User = Depends(get_current_user)) -> models.User:
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Usuário inativo")
    return current_user


def require_owner_or_admin(avaliacao: models.Avaliacao, user: models.User):
    """Garante que apenas dono ou admin acesse a avaliação."""
    if avaliacao.owner_id is None:
        return  # legado sem dono — visível para todos até migração
    if avaliacao.owner_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="Sem permissão para esta avaliação")
