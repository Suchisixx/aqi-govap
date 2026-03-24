-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;
-- Wards table
CREATE TABLE IF NOT EXISTS wards (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    geom GEOMETRY(POLYGON, 4326),
    kmz_path VARCHAR(255)
);
-- Stations table
CREATE TABLE IF NOT EXISTS stations (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    ward_id INT REFERENCES wards(id),
    lat FLOAT NOT NULL,
    lng FLOAT NOT NULL,
    pm25 FLOAT,
    pm10 FLOAT,
    aqi INT,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    traffic_level INT DEFAULT 0 CHECK (
        traffic_level BETWEEN 0 AND 10
    ),
    construction BOOLEAN DEFAULT FALSE,
    factory_near FLOAT DEFAULT 0,
    note TEXT,
    geom GEOMETRY(POINT, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED
);
-- Readings history (time-series)
CREATE TABLE IF NOT EXISTS readings (
    id SERIAL PRIMARY KEY,
    station_id INT REFERENCES stations(id) ON DELETE CASCADE,
    pm25 FLOAT,
    pm10 FLOAT,
    aqi INT,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);
-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'viewer' CHECK (role IN ('admin', 'officer', 'viewer')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Index for spatial queries
CREATE INDEX IF NOT EXISTS idx_stations_geom ON stations USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_wards_geom ON wards USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_readings_ts ON readings(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_readings_station ON readings(station_id);
-- =============================================
-- SEED: 6 wards (approximate polygons for Gò Vấp area)
-- =============================================
INSERT INTO wards (code, name, geom, kmz_path)
VALUES ('HT', 'Hạnh Thông', NULL, 'Hạnh Thông.kmz'),
    ('AN', 'An Nhơn', NULL, 'An Nhơn.kmz'),
    ('GV', 'Gò Vấp', NULL, 'Gò Vấp.kmz'),
    ('AHD', 'An Hội Đông', NULL, 'An Hội Đông.kmz'),
    (
        'TTH',
        'Thông Tây Hội',
        NULL,
        'Thông Tây Hội.kmz'
    ),
    ('AHT', 'An Hội Tây', NULL, 'An Hội Tây.kmz') ON CONFLICT (code) DO
UPDATE
SET name = EXCLUDED.name,
    kmz_path = EXCLUDED.kmz_path;
-- =============================================
-- SEED: 12 stations
-- =============================================
INSERT INTO stations (
        code,
        name,
        ward_id,
        lat,
        lng,
        pm25,
        pm10,
        aqi,
        traffic_level,
        construction,
        factory_near,
        note
    )
VALUES (
        'HT01',
        'Hạnh Thông 1',
        (
            SELECT id
            FROM wards
            WHERE code = 'HT'
        ),
        10.8266,
        106.6840,
        35,
        56,
        56,
        3,
        FALSE,
        2.5,
        'Gần Nguyễn Thái Sơn'
    ),
    (
        'HT02',
        'Hạnh Thông 2',
        (
            SELECT id
            FROM wards
            WHERE code = 'HT'
        ),
        10.8220,
        106.6805,
        85,
        120,
        95,
        5,
        FALSE,
        1.8,
        'Khu cao tầng'
    ),
    (
        'AN01',
        'An Nhơn 1',
        (
            SELECT id
            FROM wards
            WHERE code = 'AN'
        ),
        10.8393,
        106.6828,
        120,
        180,
        155,
        7,
        FALSE,
        0.5,
        'Gần sân bay'
    ),
    (
        'AN02',
        'An Nhơn 2',
        (
            SELECT id
            FROM wards
            WHERE code = 'AN'
        ),
        10.8350,
        106.6780,
        28,
        45,
        40,
        2,
        FALSE,
        3.0,
        'Công nghiệp nhẹ'
    ),
    (
        'GV01',
        'Gò Vấp 1',
        (
            SELECT id
            FROM wards
            WHERE code = 'GV'
        ),
        10.8305,
        106.6855,
        65,
        95,
        78,
        6,
        FALSE,
        2.0,
        'Gần chợ'
    ),
    (
        'GV02',
        'Gò Vấp 2',
        (
            SELECT id
            FROM wards
            WHERE code = 'GV'
        ),
        10.8270,
        106.6900,
        150,
        220,
        185,
        8,
        TRUE,
        0.3,
        'Xây dựng đường Quang Trung'
    ),
    (
        'AHD01',
        'An Hội Đông 1',
        (
            SELECT id
            FROM wards
            WHERE code = 'AHD'
        ),
        10.8250,
        106.6920,
        45,
        70,
        55,
        4,
        FALSE,
        1.5,
        'Gần Thống Nhất'
    ),
    (
        'AHD02',
        'An Hội Đông 2',
        (
            SELECT id
            FROM wards
            WHERE code = 'AHD'
        ),
        10.8215,
        106.6885,
        95,
        140,
        110,
        6,
        TRUE,
        0.8,
        'Xưởng rác'
    ),
    (
        'TTH01',
        'Thông Tây Hội 1',
        (
            SELECT id
            FROM wards
            WHERE code = 'TTH'
        ),
        10.8320,
        106.6700,
        55,
        80,
        68,
        3,
        FALSE,
        2.2,
        'Gần Lê Đức Thọ'
    ),
    (
        'TTH02',
        'Thông Tây Hội 2',
        (
            SELECT id
            FROM wards
            WHERE code = 'TTH'
        ),
        10.8285,
        106.6655,
        110,
        160,
        130,
        5,
        FALSE,
        0.4,
        'Nhà máy'
    ),
    (
        'AHT01',
        'An Hội Tây 1',
        (
            SELECT id
            FROM wards
            WHERE code = 'AHT'
        ),
        10.8180,
        106.6600,
        40,
        60,
        48,
        2,
        FALSE,
        4.0,
        'Khu xanh'
    ),
    (
        'AHT02',
        'An Hội Tây 2',
        (
            SELECT id
            FROM wards
            WHERE code = 'AHT'
        ),
        10.8145,
        106.6555,
        75,
        110,
        88,
        5,
        FALSE,
        1.2,
        'Giao thông cao điểm'
    ) ON CONFLICT (code) DO NOTHING;
-- Seed initial readings from current station values
INSERT INTO readings (station_id, pm25, pm10, aqi, timestamp)
SELECT id,
    pm25,
    pm10,
    aqi,
    NOW() - INTERVAL '30 minutes'
FROM stations;
INSERT INTO readings (station_id, pm25, pm10, aqi, timestamp)
SELECT id,
    pm25 * 0.9,
    pm10 * 0.88,
    (aqi * 0.9)::INT,
    NOW() - INTERVAL '1 hour'
FROM stations;
INSERT INTO readings (station_id, pm25, pm10, aqi, timestamp)
SELECT id,
    pm25 * 1.1,
    pm10 * 1.05,
    (aqi * 1.08)::INT,
    NOW() - INTERVAL '2 hours'
FROM stations;
INSERT INTO readings (station_id, pm25, pm10, aqi, timestamp)
SELECT id,
    pm25 * 0.8,
    pm10 * 0.82,
    (aqi * 0.82)::INT,
    NOW() - INTERVAL '3 hours'
FROM stations;
INSERT INTO readings (station_id, pm25, pm10, aqi, timestamp)
SELECT id,
    pm25 * 1.2,
    pm10 * 1.15,
    (aqi * 1.15)::INT,
    NOW() - INTERVAL '6 hours'
FROM stations;
-- Default admin user (password: admin123 - change in production!)
-- bcrypt hash of "admin123"
INSERT INTO users (username, password_hash, role)
VALUES (
        'admin',
        '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW',
        'admin'
    ),
    (
        'officer1',
        '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW',
        'officer'
    ) ON CONFLICT (username) DO NOTHING;
