import os
import databases
import sqlalchemy
from sqlalchemy import create_engine

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://aqi_user:aqi_pass@localhost:5432/aqi_gv")

database = databases.Database(DATABASE_URL)
metadata = sqlalchemy.MetaData()

engine = create_engine(DATABASE_URL)
