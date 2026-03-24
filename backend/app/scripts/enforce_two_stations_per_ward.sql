-- Ensure each ward has two stations by using station code mapping
-- and move station coordinates into the ward polygon.

UPDATE stations s
SET ward_id = w.id
FROM wards w
WHERE w.code = CASE
    WHEN s.code LIKE 'AHD%' THEN 'AHD'
    WHEN s.code LIKE 'AHT%' THEN 'AHT'
    WHEN s.code LIKE 'TTH%' THEN 'TTH'
    WHEN s.code LIKE 'GV%' THEN 'GV'
    WHEN s.code LIKE 'HT%' THEN 'HT'
    WHEN s.code LIKE 'AN%' THEN 'AN'
    ELSE NULL
END
AND s.ward_id IS DISTINCT FROM w.id;

WITH generated AS (
    SELECT
        w.id AS ward_id,
        (dp).geom AS pt,
        ROW_NUMBER() OVER (
            PARTITION BY w.id
            ORDER BY ST_X((dp).geom), ST_Y((dp).geom)
        ) AS rn
    FROM wards w
    CROSS JOIN LATERAL ST_Dump(
        ST_GeneratePoints(w.geom, 2, 20260324)
    ) AS dp
    WHERE w.geom IS NOT NULL
),
ranked_stations AS (
    SELECT
        s.id,
        s.ward_id,
        ROW_NUMBER() OVER (
            PARTITION BY s.ward_id
            ORDER BY s.code
        ) AS rn
    FROM stations s
),
targets AS (
    SELECT
        rs.id AS station_id,
        ST_Y(g.pt) AS lat,
        ST_X(g.pt) AS lng
    FROM ranked_stations rs
    JOIN generated g
      ON g.ward_id = rs.ward_id
     AND g.rn = rs.rn
)
UPDATE stations s
SET lat = t.lat,
    lng = t.lng
FROM targets t
WHERE s.id = t.station_id;
