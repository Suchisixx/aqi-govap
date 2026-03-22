# 🌫 AQI Gò Vấp — Hệ thống quan trắc không khí

Hệ thống quan trắc chất lượng không khí 6 phường Gò Vấp (sau sáp nhập 2025). Dự án này cung cấp một nền tảng toàn diện để giám sát, phân tích và trực quan hóa chất lượng không khí trong khu vực Gò Vấp, TP.HCM.

## 📋 Tổng quan

Dự án bao gồm:
- **Backend**: API RESTful với FastAPI, xử lý dữ liệu thời gian thực
- **Frontend**: Giao diện web thuần HTML/CSS/JS với bản đồ tương tác
- **Database**: PostgreSQL với PostGIS cho dữ liệu không gian
- **Realtime**: WebSocket cho cập nhật dữ liệu tức thời
- **GIS**: Nội suy không gian (IDW, Kriging) để ước tính AQI

## 🏗 Kiến trúc hệ thống

### Stack công nghệ

| Layer     | Công nghệ | Mô tả |
|-----------|-----------|-------|
| Frontend  | HTML/CSS/JS thuần + Leaflet.js + Chart.js | Giao diện bản đồ, biểu đồ, bảng dữ liệu |
| Backend   | Python FastAPI + Uvicorn | API RESTful, WebSocket |
| Database  | PostgreSQL 15 + PostGIS | Lưu trữ dữ liệu không gian và thời gian |
| GIS       | SciPy IDW, pykrige Kriging, Shapely | Xử lý nội suy không gian |
| Container | Docker Compose | Triển khai và chạy hệ thống |

### Cấu trúc thư mục

```
aqi-gv/
├── docker-compose.yml          # Cấu hình Docker Compose
├── README.md                   # Tài liệu này
├── docker/
│   ├── init.sql               # Schema DB + dữ liệu mẫu
│   └── nginx.conf             # Cấu hình Nginx reverse proxy
├── backend/
│   ├── Dockerfile             # Docker image cho backend
│   ├── requirements.txt       # Dependencies Python
│   └── app/
│       ├── main.py            # Ứng dụng FastAPI chính
│       ├── database.py        # Kết nối database
│       ├── models/__init__.py # Schemas Pydantic + tính AQI
│       ├── routers/           # API endpoints
│       │   ├── auth.py        # Xác thực JWT
│       │   ├── stations.py    # CRUD trạm đo
│       │   ├── wards.py       # GeoJSON phường
│       │   ├── interpolate.py # API nội suy
│       │   ├── dashboard.py   # Phân tích dữ liệu
│       │   └── ws.py          # WebSocket
│       └── services/          # Logic nghiệp vụ
│           ├── interpolation.py # Thuật toán IDW/Kriging
│           └── ws_manager.py   # Quản lý WebSocket
└── frontend/
    ├── index.html             # Trang chính
    ├── css/style.css         # Styles
    └── js/                    # JavaScript modules
        ├── api.js             # Client API + utilities
        ├── map.js             # Bản đồ Leaflet + heatmap
        ├── dashboard.js       # Biểu đồ Chart.js
        ├── stations.js        # Bảng trạm + form
        ├── alerts.js          # Cảnh báo
        └── app.js             # Điều phối ứng dụng
```

## 🚀 Cài đặt và chạy

### Yêu cầu hệ thống

- Docker và Docker Compose
- Ít nhất 4GB RAM
- 2GB dung lượng ổ cứng

### Chạy nhanh (1 lệnh)

```bash
# Clone repository
git clone <repository-url>
cd aqi-gv

# Chạy toàn bộ hệ thống
docker-compose up --build
```

Sau khi khởi động xong, mở trình duyệt:
- **Frontend**: http://localhost:3000
- **API Docs**: http://localhost:8000/docs
- **Database**: localhost:5432 (aqi_user/aqi_pass)

### Chạy từng bước (manual)

#### 1. Khởi động Database

```bash
docker-compose up db -d
```

Chờ database sẵn sàng (khoảng 30 giây).

#### 2. Chạy Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Backend sẽ chạy tại http://localhost:8000

#### 3. Chạy Frontend

```bash
cd frontend
# Mở file index.html trực tiếp trong browser
# Hoặc dùng server đơn giản:
python -m http.server 3000
```

Frontend sẽ chạy tại http://localhost:3000

### Biến môi trường

Backend sử dụng các biến môi trường sau (có thể cấu hình trong docker-compose.yml):

```env
DATABASE_URL=postgresql://aqi_user:aqi_pass@db:5432/aqi_gv
SECRET_KEY=supersecret_jwt_key_change_in_prod
CORS_ORIGINS=http://localhost:3000,http://localhost:8080
```

## 📊 Tính năng chính

### 🗺 Bản đồ tương tác

- **Lớp trạm đo**: Hiển thị vị trí trạm với màu sắc theo AQI, kích thước theo mức độ ô nhiễm
- **Lớp phường**: Polygon ranh giới phường với màu choropleth theo AQI trung bình
- **Heatmap IDW**: Bản đồ nhiệt với gradient AQI chuẩn VN
- **Lưới nội suy**: Hiển thị giá trị AQI ước tính trên lưới
- **Lọc theo phường**: Click vào phường hoặc chọn từ dropdown để zoom và lọc
- **KMZ phường**: Tải file KMZ chi tiết của phường khi chọn từ dropdown
- **Nội suy theo phường**: Thuật toán nội suy chỉ tính trong ranh giới phường đã chọn

### 📈 Dashboard phân tích

- Biểu đồ AQI theo thời gian cho từng trạm
- Thống kê AQI trung bình theo phường
- Xu hướng ô nhiễm theo giờ/ngày
- So sánh giữa các trạm

### 📋 Quản lý trạm đo

- Xem danh sách tất cả trạm
- Thêm/sửa/xóa trạm đo
- Cập nhật dữ liệu đo lường thủ công
- Xem lịch sử đo của từng trạm

### 🚨 Hệ thống cảnh báo

- Cảnh báo khi AQI vượt ngưỡng
- Thông báo realtime qua WebSocket
- Lịch sử cảnh báo

### 🔌 API Endpoints

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/health` | Kiểm tra trạng thái API |
| GET | `/api/stations` | Danh sách trạm (có filter `?ward_id=`) |
| GET | `/api/stations/geojson` | GeoJSON các trạm |
| GET | `/api/stations/{id}/history` | Lịch sử đo của trạm |
| POST | `/api/stations` | Thêm trạm mới |
| PUT | `/api/stations/{id}` | Cập nhật trạm |
| DELETE | `/api/stations/{id}` | Xóa trạm |
| GET | `/api/wards/geojson` | GeoJSON các phường |
| POST | `/api/interpolate` | Chạy nội suy AQI |
| GET | `/api/dashboard/stats` | Thống kê dashboard |
| POST | `/api/auth/login` | Đăng nhập |
| WebSocket | `/ws` | Kết nối realtime |

### 🔐 Xác thực

Hệ thống sử dụng JWT cho xác thực. Các role:
- **admin**: Toàn quyền
- **officer**: Quản lý trạm và dữ liệu
- **viewer**: Chỉ xem

## 🧮 Thuật toán GIS

### Tính AQI

Dựa trên công thức chuẩn VN (QCVN 05:2013/BTNMT):

```python
def calculate_aqi(pm25, pm10):
    # Tính AQI từ PM2.5 và PM10
    # Trả về giá trị AQI và category
    pass
```

### Nội suy IDW (Inverse Distance Weighting)

```
Z(x) = Σ(Zi / di^p) / Σ(1 / di^p)
```

Trong đó:
- `Zi`: Giá trị AQI tại trạm i
- `di`: Khoảng cách từ điểm cần tính đến trạm i
- `p`: Số mũ (thường = 2)

### Hiệu chỉnh cục bộ

- Gần nhà máy (< 500m): AQI × 1.2
- Có công trình xây dựng: AQI × 1.1
- Mức độ giao thông (0-10): AQI × (1 + traffic_level * 0.05)

## 🗄 Cấu trúc Database

### Bảng chính

```sql
-- Phường
wards (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE,
    name VARCHAR(100),
    geom GEOMETRY(POLYGON, 4326)
)

-- Trạm đo
stations (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE,
    name VARCHAR(100),
    ward_id INT REFERENCES wards(id),
    lat FLOAT, lng FLOAT,
    pm25 FLOAT, pm10 FLOAT, aqi INT,
    timestamp TIMESTAMPTZ,
    traffic_level INT,
    construction BOOLEAN,
    factory_near FLOAT,
    geom GEOMETRY(POINT, 4326) -- Tự động tạo từ lat/lng
)

-- Lịch sử đo
readings (
    id SERIAL PRIMARY KEY,
    station_id INT REFERENCES stations(id),
    pm25 FLOAT, pm10 FLOAT, aqi INT,
    timestamp TIMESTAMPTZ
)

-- Người dùng
users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE,
    password_hash VARCHAR(255),
    role VARCHAR(20), -- admin/officer/viewer
    created_at TIMESTAMPTZ
)
```

### Dữ liệu mẫu

Database được seed với:
- 6 phường Gò Vấp (sau sáp nhập 2025)
- 12 trạm đo mẫu
- Tài khoản admin mặc định: admin/admin123

## 🔧 Phát triển

### Thêm trạm đo mới

1. Thêm vào bảng `stations` qua API hoặc trực tiếp DB
2. Cập nhật vị trí trên bản đồ
3. Cấu hình các thông số hiệu chỉnh cục bộ

### Thêm file KMZ phường

1. Đặt file KMZ vào thư mục `docker/kmz/`
2. Đặt tên file theo format: `{CODE}.kmz`
   - `HT.kmz`: Hạnh Thông
   - `AN.kmz`: An Nhơn  
   - `GV.kmz`: Gò Vấp
   - `AHD.kmz`: An Hội Đông
   - `TTH.kmz`: Thông Tây Hội
   - `AHT.kmz`: An Hội Tây

#### Tạo KMZ từ Google Earth:

1. Mở Google Earth Pro
2. Vẽ polygon cho ranh giới phường
3. Thêm placemarks, paths, overlays nếu cần
4. File → Save → Save Place As → KML/KMZ
5. Đổi tên và đặt vào `docker/kmz/`

### Tùy chỉnh thuật toán nội suy

Sửa file `backend/app/services/interpolation.py`:
- Thay đổi tham số IDW
- Thêm phương pháp Kriging
- Tùy chỉnh lưới nội suy

### Mở rộng API

1. Tạo router mới trong `backend/app/routers/`
2. Đăng ký trong `main.py`
3. Cập nhật frontend tương ứng

## 🚀 Triển khai Production

### Bảo mật

1. Thay đổi SECRET_KEY và mật khẩu DB
2. Cấu hình HTTPS
3. Sử dụng environment variables
4. Enable authentication cho tất cả endpoints

### Tối ưu hiệu năng

1. Thêm cache Redis cho API
2. Sử dụng connection pooling cho DB
3. Tối ưu truy vấn PostGIS
4. Cấu hình Nginx load balancer

### Monitoring

- Health checks cho tất cả services
- Logging tập trung
- Metrics với Prometheus/Grafana

## 🐛 Troubleshooting

### Database không kết nối

```bash
# Kiểm tra container
docker-compose ps

# Xem logs
docker-compose logs db

# Restart database
docker-compose restart db
```

### Frontend không load

- Kiểm tra backend đang chạy: http://localhost:8000/health
- Kiểm tra CORS settings
- Xem console browser cho lỗi JS

### Nội suy không hoạt động

- Đảm bảo có ít nhất 3 trạm có dữ liệu
- Kiểm tra tọa độ GPS chính xác
- Xem logs backend cho lỗi GIS

## 📚 Tài liệu tham khảo

- [QCVN 05:2013/BTNMT - Tiêu chuẩn chất lượng không khí](https://monre.gov.vn)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Leaflet.js](https://leafletjs.com/)
- [PostGIS Manual](https://postgis.net/docs/)

## 🤝 Đóng góp

1. Fork repository
2. Tạo feature branch
3. Commit changes
4. Push và tạo Pull Request

## 📄 License

MIT License - Xem file LICENSE để biết thêm chi tiết.

---

**Liên hệ**: [Thông tin liên hệ]

**Version**: 1.0.0

**Last updated**: 2026-03-18
