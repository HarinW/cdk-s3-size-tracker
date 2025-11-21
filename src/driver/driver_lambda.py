import json
import os
import time
import urllib.request
import urllib.error

import boto3

BUCKET = os.environ.get("BUCKET_NAME")
PARAM  = os.environ.get("PLOTTING_API_PARAM", "/size-tracker/plot-url")

s3 = boto3.client("s3")
ssm = boto3.client("ssm")

def _resolve_plot_url():
    # Prefer a direct env var if you ever set it, else fetch from SSM
    url = os.getenv("PLOTTING_API_URL")
    if url:
        return url
    if not PARAM:
        raise RuntimeError("Missing PLOTTING_API_URL or PLOTTING_API_PARAM")
    resp = ssm.get_parameter(Name=PARAM)
    return resp["Parameter"]["Value"]

def _put(key: str, body: str):
    s3.put_object(Bucket=BUCKET, Key=key, Body=body.encode("utf-8"))

def _delete(key: str):
    s3.delete_object(Bucket=BUCKET, Key=key)

def _sleep(seconds: int):
    time.sleep(seconds)

def _call_plotting_api():
    url = _resolve_plot_url()
    print(f"Calling plotting API: {url}")
    try:
        with urllib.request.urlopen(url) as resp:
            data = resp.read().decode("utf-8")
            return json.loads(data) if resp.headers.get_content_type()=="application/json" else {"raw": data}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        # RETURN the error body so we can see the Lambda/API message
        return {"http_error": e.code, "url": url, "body": body}

def lambda_handler(event, context):
    # 1) Create assignment1.txt (19 bytes)
    _put("assignment1.txt", "Empty Assignment 11")
    _sleep(5)

    # _put("assignment1.txt", "Empty Assignment 2222222222")
    # _sleep(2)

    # 2) Create assignment2.txt (28 bytes) -> Alarm should SUM > 20 => Cleaner deletes largest (assignment2.txt)
    _put("assignment2.txt", "Empty Assignment 2222222222")
    time.sleep(420)  # allow metric period to close & alarm to act
    # 1 min period + 30s SQS visibility + 1 min alarm evaluation + buffer

    # _delete("assignment1.txt")
    # _sleep(2)
    # _put("assignment2.txt", "33")
    # _sleep(2)

    # 3) Create assignment3.txt (2 bytes) -> Cleaner should delete assignment1.txt
    _put("assignment3.txt", "33")
    time.sleep(420)

    # 4) Call plotting API
    plot_resp = _call_plotting_api()
    
    return {"statusCode": 200, "body": json.dumps({"plot": plot_resp})}
