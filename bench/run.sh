#!/usr/bin/env bash
set -euo pipefail

STRATEGY="${1:-atomic}"
REPLICAS="${REPLICAS:-1}"
VUS="${VUS:-200}"
UNITS="${UNITS:-1}"
DROP_CHECK="${DROP_CHECK:-0}"

LAUNCHER="$(cd "$(dirname "$0")/../.." && pwd)"
GATEWAY_HOST="${GATEWAY_HOST:-http://localhost:3002}"
GATEWAY_NET="${GATEWAY_NET:-http://api-gateway:3000}"

psql_booking() {
  docker exec -i stays-postgres psql -U stays -d booking -tAq "$@"
}

json() {
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log($1)})"
}

cd "$LAUNCHER"

EMAIL=$(grep '^SEED_ADMIN_EMAIL=' .env | cut -d= -f2-)
PASSWORD=$(grep '^SEED_ADMIN_PASSWORD=' .env | cut -d= -f2-)

TOKEN=$(curl -s -X POST "$GATEWAY_HOST/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | json 'j.accessToken ?? j.token')

RUN_ID=$(date +%s)
CHECK_IN=$(date -u -d "2030-01-01 + $((RUN_ID % 3000)) days" +%F)
CHECK_OUT=$(date -u -d "$CHECK_IN + 1 day" +%F)

if [ -z "${ROOM_TYPE_ID:-}" ]; then
  HOTEL_ID=$(curl -s "$GATEWAY_HOST/api/search?limit=1" | json 'j.data[0].id')
  ROOM_TYPE_ID=$(curl -s "$GATEWAY_HOST/api/hotels/$HOTEL_ID/room-types?limit=1" | json 'j.data[0].id')
fi

echo "strategy=$STRATEGY replicas=$REPLICAS vus=$VUS units=$UNITS"
echo "roomType=$ROOM_TYPE_ID night=$CHECK_IN drop_check=$DROP_CHECK"

curl -s -X PUT "$GATEWAY_HOST/api/admin/inventory" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"roomTypeId\":\"$ROOM_TYPE_ID\",\"from\":\"$CHECK_IN\",\"to\":\"$CHECK_OUT\",\"totalUnits\":$UNITS}" > /dev/null

if [ "$DROP_CHECK" = "1" ]; then
  psql_booking -c "ALTER TABLE inventory DROP CONSTRAINT IF EXISTS no_overbooking;" > /dev/null
fi

BOOKING_STRATEGY="$STRATEGY" docker compose up -d --force-recreate --scale booking-ms="$REPLICAS" booking-ms > /dev/null 2>&1

until [ "$(docker compose ps -q booking-ms | wc -l)" = "$REPLICAS" ] &&
      [ "$(docker exec stays-rabbitmq rabbitmqctl list_queues name consumers 2>/dev/null | awk '$1=="booking_queue"{print $2}')" = "$REPLICAS" ]; do
  sleep 2
done

docker run --rm -i --network stays_default \
  -e GATEWAY="$GATEWAY_NET" -e TOKEN="$TOKEN" -e ROOM_TYPE_ID="$ROOM_TYPE_ID" \
  -e CHECK_IN="$CHECK_IN" -e CHECK_OUT="$CHECK_OUT" -e VUS="$VUS" -e RUN_ID="$RUN_ID" \
  grafana/k6 run - < "$LAUNCHER/booking-ms/bench/booking.js" 2>&1 |
  grep -E "booking_created|booking_rejected|booking_failed|http_req_duration|iterations" || true

if [ "$DROP_CHECK" = "1" ]; then
  echo
  echo "--- overbooked rows left by this run ---"
  docker exec -i stays-postgres psql -U stays -d booking -c "
  SELECT date, total_units, reserved_units
  FROM inventory
  WHERE room_type_id = '$ROOM_TYPE_ID' AND date = '$CHECK_IN'
    AND reserved_units > total_units;"

  psql_booking -v ON_ERROR_STOP=1 -c "
  UPDATE bookings b SET status = 'expired', expires_at = NULL
  WHERE b.status = 'held'
    AND EXISTS (SELECT 1 FROM inventory i
                WHERE i.room_type_id = b.room_type_id
                  AND i.date >= b.check_in AND i.date < b.check_out
                  AND i.reserved_units > i.total_units);
  UPDATE inventory SET reserved_units = 0 WHERE reserved_units > total_units;
  ALTER TABLE inventory ADD CONSTRAINT no_overbooking
    CHECK (reserved_units >= 0 AND reserved_units <= total_units);"
fi

echo
echo "--- database result ---"
docker exec -i stays-postgres psql -U stays -d booking -c "
SELECT i.total_units AS capacity,
       i.reserved_units AS reserved,
       (SELECT count(*) FROM bookings b
         WHERE b.room_type_id = i.room_type_id AND b.check_in = i.date) AS booking_rows
FROM inventory i
WHERE i.room_type_id = '$ROOM_TYPE_ID' AND i.date = '$CHECK_IN';"
