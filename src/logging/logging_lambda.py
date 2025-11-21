import os, json, logging, time, urllib.parse
import boto3
from boto3.session import Session

log = logging.getLogger()
log.setLevel(logging.INFO)

FUNCTION_NAME = os.environ["AWS_LAMBDA_FUNCTION_NAME"]
LOG_GROUP = f"/aws/lambda/{FUNCTION_NAME}"
logs_client = boto3.client("logs")
session: Session = boto3.session.Session()

def _decode_key(k: str) -> str:
    return urllib.parse.unquote_plus(k)

def _find_created_size(object_name: str) -> int | None:
    # Search previous positive size_delta for same object_name
    # Filter pattern for JSON logs:
    #   { $.object_name = "name" && $.size_delta = * }
    start = int((time.time() - 3600) * 1000) # 1h lookback (tweak as needed)

    log.info(f"SEARCHING LOG GROUP: {LOG_GROUP}")
    log.info(f"START TIME (ms): {start}")

    # Simple substring filter: match any log line that contains the object name
    filter_pattern = f'"{object_name}"'
    log.info(f"FILTER PATTERN: {filter_pattern}")
    # patt = '{ $.object_name = "' + object_name + '" }'

    next_token = None
    latest_match: tuple[int, int] | None = None  # (timestamp, delta)
    #for attempt in range(3):
    while True:
        try:
            params = {
                "logGroupName": LOG_GROUP,
                "startTime": start,
                "limit": 100,               # small page; we can loop
                "filterPattern": filter_pattern,
            }
            if next_token:
                params["nextToken"] = next_token
            # get recent events and filter in code
            resp = logs_client.filter_log_events(**params)
        except logs_client.exceptions.ResourceNotFoundException:
            log.warning(f"Log group {LOG_GROUP} not found")
            return None
        except Exception as e:
            log.warning("filter_log_events error: %s", e)
            return None
        
        events = resp.get("events", [])
        log.info(f"filter_log_events returned {len(events)} events for {object_name}")
        # Find first positive size_delta
        matches = []
        for ev in events:
            msg = ev.get("message", "")
            # Extract the JSON substring inside the log message
            start_idx = msg.find("{")
            end_idx = msg.rfind("}")
            if start_idx == -1 or end_idx == -1:
                continue
            json_part = msg[start_idx:end_idx+1]
            try:
                data = json.loads(json_part)
                # if data.get("object_name") == object_name:
                #     delta = int(data.get("size_delta", 0))
                #     if delta > 0:
                #         matches.append(delta)
            except Exception:
                continue
        
            if data.get("object_name") != object_name:
                    continue
            # if matches:
            #     return matches[-1]  # most recent create event
            try:
                delta = int(data.get("size_delta", 0))
            except Exception:
                continue

            # We only care about CREATE events' positive deltas
            if delta > 0:
                ts = ev.get("timestamp", 0)
                # Keep the most recent one
                if latest_match is None or ts > latest_match[0]:
                    latest_match = (ts, delta)
        # Pagination: if there's no nextToken, we're done
        next_token = resp.get("nextToken")
        if not next_token:
            break
        # time.sleep(2)  # retry delay
    if latest_match:
        _, size = latest_match
        log.info(f"FOUND previous size for {object_name}: {size}")
        return size
    log.info(f"No previous positive size_delta found for {object_name}")
    return None

def lambda_handler(event, context):
    for rec in event.get("Records", []):
        body = rec.get("body")
        if not body:
            continue
        try:
            msg = json.loads(body)  # Raw S3 event
        except Exception:
            continue

        for r in msg.get("Records", []):
            etype = r.get("eventName", "")
            bucket = r["s3"]["bucket"]["name"]
            key = _decode_key(r["s3"]["object"]["key"])

            if etype.startswith("ObjectCreated"):
                size = int(r["s3"]["object"].get("size", 0))
                log.info(json.dumps({"object_name": key, "size_delta": size, "bucket": bucket}))
            elif etype.startswith("ObjectRemoved"):
                # S3 delete event doesn’t include size; look it up from previous logs
                prev_size = _find_created_size(key)
                if prev_size is None:
                    # fall back to 0 if not found
                    prev_size = 0
                log.info(json.dumps({"object_name": key, "size_delta": -prev_size, "bucket": bucket}))
    return {"statusCode": 200, "body": json.dumps({"ok": True})}
