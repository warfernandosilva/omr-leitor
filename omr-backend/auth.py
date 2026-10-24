import os
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select, true
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

# auto_error=False: sem header Authorization o token vira None e a decisão
# (401 padrão ou bypass de dev) fica em get_current_user.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def dev_anonymous_enabled() -> bool:
    """Bypass de autenticação SÓ para desenvolvimento local (nunca em produção).

    Liga com `OMR_DEV_ANONYMOUS=1` (ver .env.example). É SEMPRE ignorado quando
    `OMR_ENV=production`, para que um env vazado não abra o sistema em produção.
    """
    if os.environ.get("OMR_ENV", "development") == "production":
        return False
    return os.environ.get("OMR_DEV_ANONYMOUS", "").strip().lower() in ("1", "true", "yes", "on")


def _dev_anonymous_user() -> models.User:
    """Usuário admin sintético (transiente, não persistido) do modo dev anônimo."""
    return models.User(id=1, email="dev@clone.local", nome="Desenvolvedor",
                       role="admin", is_active=True)


def get_current_user(
    token: str | None = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> models.User:
    if dev_anonymous_enabled():
        return _dev_anonymous_user()

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido ou expirado",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_exception
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


def get_current_active_user(current_user: models.User = Depends(get_current_user)) -> models.User:
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Usuário inativo")
    return current_user


def owner_clause(model, user: models.User):
    """Cláusula SQL de visibilidade: admin vê tudo, usuário vê só o que criou.

    Registro sem dono (legado ou de usuário excluído) fica só para o admin:
    ninguém herda o que não criou.
    """
    if user.role == "admin":
        return true()
    return model.owner_id == user.id


def require_owner_or_admin(avaliacao: models.Avaliacao, user: models.User):
    """Garante que apenas dono ou admin acesse a avaliação (sem dono = só admin)."""
    if user.role == "admin" or avaliacao.owner_id == user.id:
        return
    raise HTTPException(status_code=403, detail="Sem permissão para esta avaliação")


def require_turma_owner_or_admin(turma: models.Turma, user: models.User):
    """Mesma política de `require_owner_or_admin` para turmas."""
    if user.role == "admin" or turma.owner_id == user.id:
        return
    raise HTTPException(status_code=403, detail="Sem permissão para esta turma")


def require_lab_owner_or_admin(session: models.LabSession, user: models.User):
    """Mesma política de `require_owner_or_admin` para sessões do Laboratório."""
    if user.role == "admin" or session.owner_id == user.id:
        return
    raise HTTPException(status_code=403, detail="Sem permissão para esta sessão do Laboratório")
