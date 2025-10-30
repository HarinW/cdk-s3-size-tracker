import json
import os
import time
import urllib.request

import boto3

BUCKET = os.environ.get("BUCKET_NAME")
PLOTTING_API_URL = os.environ.get("PLOTTING_API_URL")

s3 = boto3.client("s3")

def _put(key: str, body: str):
    s3.put_object(Bucket=BUCKET, Key=key, Body=body.encode("utf-8"))

def _delete(key: str):
    s3.delete_object(Bucket=BUCKET, Key=key)

def _sleep(seconds: int):
    time.sleep(seconds)

def _call_plotting_api():
    if not PLOTTING_API_URL:
        return {"error": "PLOTTING_API_URL not set"}
    with urllib.request.urlopen(PLOTTING_API_URL) as resp:
        data = resp.read()
        return json.loads(data.decode("utf-8"))

def lambda_handler(event, context):
    # 1) Create assignment1.txt (19 bytes)
    _put("assignment1.txt", "Empty Assignment 1")
    _sleep(2)

    # 2) Update assignment1.txt to 28 bytes
    _put("assignment1.txt", "Empty Assignment 2222222222")
    _sleep(2)

    # 3) Delete assignment1.txt
    _delete("assignment1.txt")
    _sleep(2)

    # 4) Create assignment2.txt (2 bytes)
    _put("assignment2.txt", "33")
    _sleep(2)

    # 5) Call plotting API
    plot_resp = _call_plotting_api()
    
    return {"statusCode": 200, "body": json.dumps({"plot": plot_resp})}
