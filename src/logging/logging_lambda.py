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
    patt = '{ $.object_name = "' + object_name + '" && $.size_delta = * }'
    resp = logs_client.filter_log_events(
        logGroupName=LOG_GROUP,
        startTime=start,
        filterPattern=patt,
        limit=50,
    )
    # Find first positive size_delta
    for ev in resp.get("events", []):
        try:
            data = json.loads(ev["message"])
            delta = int(data.get("size_delta", 0))
            if delta > 0:
                return delta
        except Exception:
            continue
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
