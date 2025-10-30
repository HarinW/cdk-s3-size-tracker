import json
import boto3
import os
from datetime import datetime


REGION = os.getenv('AWS_REGION', 'us-east-1')
TABLE_NAME = os.environ.get('DDB_TABLE')

s3_client = boto3.client('s3', region_name=REGION)
ddb = boto3.resource('dynamodb', region_name=REGION)
table = ddb.Table(TABLE_NAME)

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
    records = event.get('Records', [])
    if not records:
        return {'statusCode': 200, 'body': 'No records'}

    bucket_name = records[0]['s3']['bucket']['name']
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
