import os
import asyncio
import unicodedata
from app.database import database
from app.services.kmz_loader import read_kmz_geometry

KMZ_DIR = "/app/app/kmz"

WARD_MAPPING = {
    "Hạnh Thông.kmz": "Hạnh Thông",
    "An Nhơn.kmz": "An Nhơn",
    "Gò Vấp.kmz": "Gò Vấp",
    "An Hội Đông.kmz": "An Hội Đông",
    "Thông Tây Hội.kmz": "Thông Tây Hội",
    "An Hội Tây.kmz": "An Hội Tây",
}

def norm_text(s: str) -> str:
    return unicodedata.normalize("NFC", s).strip()

async def main():
    await database.connect()

    try:
        actual_files = os.listdir(KMZ_DIR)
        print("Files trong thư mục kmz:")
        for f in actual_files:
            print(" -", repr(f))

        normalized_actual = {
            norm_text(filename): filename
            for filename in actual_files
            if filename.lower().endswith(".kmz")
        }

        success_count = 0
        fail_count = 0

        for expected_filename, ward_name in WARD_MAPPING.items():
            normalized_expected = norm_text(expected_filename)

            if normalized_expected not in normalized_actual:
                print(f"[SKIP] Không tìm thấy file: {expected_filename}")
                continue

            real_filename = normalized_actual[normalized_expected]
            path = os.path.join(KMZ_DIR, real_filename)

            try:
                print(f"Đang import {real_filename} -> {ward_name}")
                geom = read_kmz_geometry(path)

                await database.execute(
                    """
                    UPDATE wards
                    SET geom = ST_Multi(ST_GeomFromText(:wkt, 4326))
                    WHERE name = :name
                    """,
                    {
                        "wkt": geom.wkt,
                        "name": ward_name,
                    },
                )
                print(f"[OK] {ward_name}")
                success_count += 1
            except Exception as ex:
                print(f"[ERROR] {real_filename} ({ward_name}): {ex}")
                fail_count += 1

        print(f"Import hoàn tất. Thành công: {success_count}, lỗi: {fail_count}")

    finally:
        await database.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
