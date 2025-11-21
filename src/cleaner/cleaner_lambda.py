import os, logging, boto3

log = logging.getLogger()
log.setLevel(logging.INFO)

BUCKET = os.environ["BUCKET_NAME"]
s3 = boto3.client("s3")

def lambda_handler(event, context):
    # Find largest object
    largest = None
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=BUCKET):
        for obj in page.get("Contents", []):
            if largest is None or obj["Size"] > largest["Size"]:
                largest = obj
    if not largest:
        log.info("Bucket empty; nothing to delete.")
        return {"statusCode": 200, "body": "No objects"}

    key = largest["Key"]
    size = largest["Size"]
    log.info(f"Deleting largest object: {key} ({size} bytes)")
    s3.delete_object(Bucket=BUCKET, Key=key)
    return {"statusCode": 200, "body": f"Deleted {key} ({size} bytes)"}
