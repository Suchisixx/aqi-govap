-- Re-assign stations.ward_id by real ward polygons after KMZ import.
-- Priority: contains -> intersects -> nearest ward.

WITH station_points AS (
    SELECT
        s.id,
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
  AND m.new_ward_id IS NOT NULL;
