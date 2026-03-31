import os
import socket

import databases
import sqlalchemy
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url


def _can_resolve_host(host: str) -> bool:
    if not host:
        return False
    try:
        socket.getaddrinfo(host, None)
        return True
    except socket.gaierror:
        return False


def _normalize_database_url(raw_url: str) -> str:
    url = make_url(raw_url)
    host = url.host
    if not host:
        return raw_url

    if _can_resolve_host(host):
        return raw_url

    candidate_hosts = []
    if host in {"db", "aqi_db", "postgres"}:
        candidate_hosts.extend(["db", "aqi_db", "postgres"])
    elif host in {"localhost", "127.0.0.1"}:
        candidate_hosts.extend(["localhost", "127.0.0.1"])
    else:
        candidate_hosts.extend([host, "db", "aqi_db", "postgres", "localhost", "127.0.0.1"])

    seen = set()
    for candidate in candidate_hosts:
        if candidate in seen:
            continue
        seen.add(candidate)
        if _can_resolve_host(candidate):
            return str(url.set(host=candidate))

    return raw_url


DATABASE_URL = _normalize_database_url(
    os.getenv("DATABASE_URL", "postgresql://aqi_user:aqi_pass@localhost:5432/aqi_gv")
)

database = databases.Database(DATABASE_URL)
metadata = sqlalchemy.MetaData()

engine = create_engine(DATABASE_URL)
