from __future__ import annotations

import json
from typing import Any

from app.database import database


async def log_action(
    *,
    user: dict | None,
    action: str,
    entity_type: str,
    entity_id: int | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    actor_id = user["id"] if user else None
    actor_username = user["username"] if user else "system"
    await database.execute(
        """
        INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, details)
        VALUES (:user_id, :username, :action, :entity_type, :entity_id, CAST(:details AS JSONB))
        """,
        {
            "user_id": actor_id,
            "username": actor_username,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "details": json.dumps(details or {}, ensure_ascii=True),
        },
    )

