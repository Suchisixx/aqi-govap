import asyncio
from app.database import database


ASSIGN_SQL = """
WITH station_points AS (
    SELECT
        s.id,
        s.ward_id AS old_ward_id,
        ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326) AS pt
    FROM stations s
),
matched AS (
    SELECT
        sp.id AS station_id,
        COALESCE(
            (
                SELECT w.id
                FROM wards w
                WHERE w.geom IS NOT NULL
                  AND ST_Contains(w.geom, sp.pt)
                LIMIT 1
            ),
            (
                SELECT w.id
                FROM wards w
                WHERE w.geom IS NOT NULL
                  AND ST_Intersects(w.geom, sp.pt)
                LIMIT 1
            ),
            (
                SELECT w.id
                FROM wards w
                WHERE w.geom IS NOT NULL
                ORDER BY ST_Distance(w.geom::geography, sp.pt::geography)
                LIMIT 1
            )
        ) AS new_ward_id
    FROM station_points sp
)
UPDATE stations s
SET ward_id = m.new_ward_id
FROM matched m
WHERE s.id = m.station_id
  AND m.new_ward_id IS NOT NULL
RETURNING s.id, s.code, s.name, s.ward_id;
"""


async def main():
    await database.connect()
    try:
        updated = await database.fetch_all(ASSIGN_SQL)
        print(f"Reassigned {len(updated)} stations to ward polygons.")

        counts = await database.fetch_all(
            """
            SELECT w.id, w.name, COUNT(s.id) AS station_count
            FROM wards w
            LEFT JOIN stations s ON s.ward_id = w.id
            GROUP BY w.id, w.name
            ORDER BY w.id
            """
        )
        for row in counts:
            print(f"- {row['name']}: {row['station_count']} station(s)")
    finally:
        await database.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
