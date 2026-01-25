# EVS API Reference (Used by This Project)

This document lists the EVS endpoints used by this bot, the request/response structure we observed, and how the bot uses each API.

All EVS calls use JSON and (except login) require a bearer token:

```
Authorization: Bearer <token>
Content-Type: application/json
```

## 1) Login

**Endpoint**
- `POST https://evs2u.evs.com.sg/login`

**Purpose**
- Authenticate a user and retrieve a bearer token for subsequent EVS API calls.

**Request body**
```json
{
  "username": "<evs_username>",
  "password": "<evs_password>",
  "destPortal": "evs2cp",
  "platform": "web"
}
```

**Response (example)**
```json
{
  "token": "<jwt>",
  "err": null,
  "userInfo": {
    "scope_str": "evs2_nus",
    "id": 2372,
    "username": "10003671",
    "dest_portal": "evs2cp"
  }
}
```

**Used by**
- `evsLogin_(username, password)`
- Every command that needs meter data (`/status`, `/balance`, `/usage`, `/myinfo`, `/history`, `/leaderboard`, notifications).

---

## 2) Meter Info

**Endpoint**
- `POST https://ore.evs.com.sg/cp/get_meter_info`

**Request wrapper**
All ORE requests are wrapped in:
```json
{
  "svcClaimDto": {
    "username": "<evs_username>",
    "user_id": null,
    "svcName": "oresvc",
    "endpoint": "/cp/get_meter_info",
    "scope": "self",
    "target": "meter.p.info",
    "operation": "read"
  },
  "request": {
    "meter_displayname": "<evs_username>"
  }
}
```

**Response (example)**
```json
{
  "meter_info": {
    "premise": {"block":"28","level":"8","unit":"501F"},
    "address": "Block 28, 8-501F ...",
    "meter_sn": "202501060514",
    "meter_displayname": "10003671",
    "mms_online_timestamp": "2026-01-25T15:00:24",
    "tariff_price": 7.75
  }
}
```

**Used by**
- `getMeterInfo_(token, username)`
- `/status` for meter metadata
- `/myinfo` for location and meter details

---

## 3) Credit Balance

**Endpoint**
- `POST https://ore.evs.com.sg/tcm/get_credit_balance`

**Request wrapper**
```json
{
  "svcClaimDto": {
    "username": "<evs_username>",
    "user_id": null,
    "svcName": "oresvc",
    "endpoint": "/tcm/get_credit_balance",
    "scope": "self",
    "target": "meter.credit_balance",
    "operation": "read"
  },
  "request": {
    "meter_displayname": "<evs_username>"
  }
}
```

**Response (example)**
```json
{
  "ref_bal": "41.82000000",
  "tariff_timestamp": "2026-01-25 21:00:23"
}
```

**Used by**
- `getCreditBalance_(token, username)`
- `/status` and `/balance`
- notifications (low balance)

### 3b) EVS1 Credit Balance (Fallback)

**Endpoint**
- `POST https://ore.evs.com.sg/evs1/get_credit_bal`

**Request wrapper**
```json
{
  "svcClaimDto": {
    "username": "<evs_username>",
    "user_id": null,
    "svcName": "oresvc",
    "endpoint": "/evs1/get_credit_bal",
    "scope": "self",
    "target": "meter.credit_balance",
    "operation": "read"
  },
  "request": {
    "meter_displayname": "<evs_username>"
  }
}
```

**Response (example)**
```json
{
  "meter_overused_kwh": 0.0,
  "credit_bal": 47.84374,
  "overused_kwh": 0.0,
  "tariff_timestamp": "2026-01-24 01:05:01",
  "meter_overused_timestamp": "2026-01-24 01:05:01"
}
```

**Used by**
- `getCreditBalance_(token, username)` as a fallback when the main credit balance endpoint returns no data (e.g., `"Credit balance not found"`).

---

## 4) Month‑to‑Date Usage

**Endpoint**
- `POST https://ore.evs.com.sg/get_month_to_date_usage`

**Request wrapper**
```json
{
  "svcClaimDto": {
    "username": "<evs_username>",
    "user_id": null,
    "svcName": "oresvc",
    "endpoint": "/get_month_to_date_usage",
    "scope": "self",
    "target": "meter.p.month_to_date_kwh_usage",
    "operation": "read"
  },
  "request": {
    "meter_displayname": "<evs_username>",
    "convert_to_money": "true"
  }
}
```

**Response (example)**
```json
{
  "month_to_date_usage": -77.78
}
```

**Used by**
- `getMonthToDateUsage_(token, username)`
- `/status` and `/usage`

---

## 5) Daily Usage History

**Endpoint**
- `POST https://ore.evs.com.sg/get_history`

**Request wrapper**
```json
{
  "svcClaimDto": {
    "username": "<evs_username>",
    "user_id": null,
    "svcName": "oresvc",
    "endpoint": "/get_history",
    "scope": "self",
    "target": "meter.reading",
    "operation": "list"
  },
  "request": {
    "meter_displayname": "<evs_username>",
    "history_type": "meter_reading_daily",
    "start_datetime": "<ISO-like start>",
    "end_datetime": "<ISO-like end>",
    "normalization": "meter_reading_daily",
    "max_number_of_records": "50",
    "convert_to_money": "true",
    "check_bypass": "true"
  }
}
```

**Response (example)**
```json
{
  "meter_reading_daily": {
    "history": [
      {
        "reading_timestamp": "2026-01-25T00:00:00",
        "reading_diff": 2.31,
        "is_estimated": false
      }
    ]
  }
}
```

**Used by**
- `getUsageHistory_(token, username, days)`
- `/history` (daily list)
- `/status` runout projections (7/14/30‑day averages)
- notifications (runout alert)

---

## 6) Recent Usage Stat (Leaderboard / Ranking)

**Endpoint**
- `POST https://ore.evs.com.sg/cp/get_recent_usage_stat`

**Request wrapper**
```json
{
  "svcClaimDto": {
    "username": "<evs_username>",
    "user_id": null,
    "svcName": "oresvc",
    "endpoint": "/cp/get_recent_usage_stat",
    "scope": "self",
    "target": "meter.reading",
    "operation": "list"
  },
  "request": {
    "meter_displayname": "<evs_username>",
    "look_back_hours": 168,
    "convert_to_money": true
  }
}
```

**Response (example)**
```json
{
  "usage_stat": {
    "kwh_rank_in_building": {
      "id": "1715738",
      "updated_timestamp": "2026-01-25 08:16:49",
      "rank_type": "168 hours",
      "meter_sn": "202501060514",
      "meter_displayname": "10003671",
      "rank_val": "0E-8",
      "rank_ref": "28-28-college-ave-west-138533",
      "ref_val": "26.838250000000002",
      "ref_val_unit": "kWh"
    }
  }
}
```

**Used by**
- `getRecentUsageStat_(token, username, lookBackHours)`
- `/status` to show rank and building usage (uses 168h)
- `/leaderboard` to show rank snapshots (de‑dupes identical results)

**Notes**
- In observed responses, different `look_back_hours` values often return the same `rank_type` and values. The bot de‑duplicates identical responses and labels by API `rank_type`.

---

## Common Notes / Conventions

- All ORE requests wrap the payload with `svcClaimDto` + `request`.
- `meter_displayname` is always the EVS username string.
- Most values are strings in the API response even when numeric; the bot normalizes them to numbers where needed.
- Errors:
  - `403` is treated as “Not authorized”.
  - Other `>=400` are surfaced as request failure with response text.

If you add a new EVS endpoint, copy the same wrapper structure and update this document.
