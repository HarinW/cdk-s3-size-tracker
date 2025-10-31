import json
import boto3
import os
import logging
from datetime import datetime


REGION = os.getenv('AWS_REGION')
TABLE_NAME = os.environ.get('DDB_TABLE')

s3_client = boto3.client('s3', region_name=REGION)
ddb = boto3.resource('dynamodb', region_name=REGION)
table = ddb.Table(TABLE_NAME)

log = logging.getLogger()
log.setLevel(logging.INFO)

# ---- Helpers ----
def _get_bucket_from_event(event) -> str | None:
    """
    Supports BOTH:
      1) EventBridge S3 event: event["detail"]["bucket"]["name"]
      2) S3 -> Lambda notification: event["Records"][...]["s3"]["bucket"]["name"]
    Returns a bucket name or None.
    """
    # EventBridge shape
    if "detail" in event and isinstance(event["detail"], dict):
        b = event["detail"].get("bucket")
        if isinstance(b, dict) and "name" in b:
            return b["name"]

    # S3 notification shape
    if "Records" in event and isinstance(event["Records"], list) and event["Records"]:
        rec0 = event["Records"][0]
        if "s3" in rec0 and "bucket" in rec0["s3"] and "name" in rec0["s3"]["bucket"]:
            return rec0["s3"]["bucket"]["name"]

    return None

def calc_bucket_size_count(bucket_name: str):
    # Sum size and count of all CURRENT objects (no versioning assumed)
    total_size = 0
    total_count = 0
    paginator = s3_client.get_paginator('list_objects_v2')

    for page in paginator.paginate(Bucket=bucket_name):
        for obj in page.get('Contents', []):
            total_size += obj.get('Size', 0)
            total_count += 1
    
    return total_size, total_count

def lambda_handler(event, context):
    # S3 event -> determine bucket from the event (single or multiple records)
    bucket_name = _get_bucket_from_event(event)
    if not bucket_name:
        # Optional: allow a fallback to an env var if you only track one bucket
        bucket_name = os.getenv("BUCKET_NAME")
        if not bucket_name:
            log.warning("No bucket name found in event or env; nothing to do.")
            return {"statusCode": 200, "body": json.dumps({"message": "No bucket detected"})}

    total_size, total_count = calc_bucket_size_count(bucket_name)

    now = datetime.now()
    ts = int(now.timestamp())

    item = {
        'bucket': bucket_name,
        'ts': ts,
        'total_size': total_size,
        'total_count': total_count
    }
    table.put_item(Item=item)

    return {
        'statusCode': 200,
        'body': {
            "message": "Recorded bucket totals",
            "bucket_name": bucket_name,
            "ts": now,
            "total_size": total_size,
            "total_count": total_count,
        }
    }
