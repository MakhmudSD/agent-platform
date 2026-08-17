from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.models import Folder, Run, User
from app.db.session import get_db

router = APIRouter(prefix="/folders", tags=["folders"])


class CreateFolderRequest(BaseModel):
    name: str


@router.get("")
def list_folders(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    folders = db.query(Folder).filter(Folder.user_id == user.id).order_by(Folder.created_at.asc()).all()
    # Per-folder count comes from a real query, not a client-side guess --
    # small table, N+1 here is fine at this scale (same tradeoff already
    # made elsewhere in this codebase, e.g. list_runs).
    return [
        {
            "id": f.id,
            "name": f.name,
            "created_at": f.created_at.isoformat(),
            "run_count": db.query(Run).filter(Run.folder_id == f.id).count(),
        }
        for f in folders
    ]


@router.post("")
def create_folder(body: CreateFolderRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Folder name can't be empty")
    folder = Folder(user_id=user.id, name=name)
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return {"id": folder.id, "name": folder.name, "created_at": folder.created_at.isoformat(), "run_count": 0}


@router.delete("/{folder_id}")
def delete_folder(folder_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    folder = db.get(Folder, folder_id)
    if folder is None or folder.user_id != user.id:
        raise HTTPException(status_code=404, detail="Folder not found")
    # Un-file its runs rather than cascading -- deleting how you organized
    # something must never delete the thing itself (same principle as
    # archive; see Folder's docstring in models.py).
    db.query(Run).filter(Run.folder_id == folder_id).update({"folder_id": None})
    db.delete(folder)
    db.commit()
    return {"deleted": True}
