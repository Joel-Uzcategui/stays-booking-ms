import http from 'k6/http';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';

const created = new Counter('booking_created');
const rejected = new Counter('booking_rejected');
const failed = new Counter('booking_failed');

const VUS = Number(__ENV.VUS || 200);

export const options = {
  scenarios: {
    rush: {
      executor: 'shared-iterations',
      vus: VUS,
      iterations: VUS,
      maxDuration: '3m',
    },
  },
  thresholds: {
    booking_failed: ['count==0'],
  },
};

export default function () {
  const body = JSON.stringify({
    roomTypeId: __ENV.ROOM_TYPE_ID,
    checkIn: __ENV.CHECK_IN,
    checkOut: __ENV.CHECK_OUT,
    units: 1,
  });

  const response = http.post(`${__ENV.GATEWAY}/api/bookings`, body, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${__ENV.TOKEN}`,
      'Idempotency-Key': `bench-${__ENV.RUN_ID}-${exec.scenario.iterationInTest}`,
    },
  });

  if (response.status === 201) {
    created.add(1);
  } else if (response.status === 409) {
    rejected.add(1);
  } else {
    failed.add(1);
    console.error(`${response.status} ${response.body}`);
  }
}
