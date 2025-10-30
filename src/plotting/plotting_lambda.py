import json
import os
import io
from datetime import datetime

import boto3
import matplotlib
matplotlib.use('Agg')  # non-interactive backend for Lambda
import matplotlib.pyplot as plt

REGION = os.environ.get('AWS_REGION', 'us-east-1')
DDB_TABLE = 'S3-object-size-history'
DDB_GSI = os.environ.get("DDB_GSI", "gsi_size")
BUCKET = os.environ.get('BUCKET_NAME', 'TestBucket')
PLOT_KEY = os.environ.get('PLOT_KEY', 'plot')

ddb = boto3.resource('dynamodb')
table = ddb.Table(DDB_TABLE)
s3 = boto3.client('s3')

def _query_last_10s(bucket: str):
    now = int(datetime.now().timestamp())
    start_ts = now - 10
    resp = table.query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key('bucket_name').eq(bucket)
        & boto3.dynamodb.conditions.Key('timestamp').between(start_ts, now),
        ScanIndexForward=True, # ascending by ts
    )
    
    items = resp.get('Items', [])
    
    return items

def _query_all_time_max_size(bucket: str):
    # Use GSI to avoid scans: query by bucket, sort by total_size desc
    resp = table.query(
        IndexName=DDB_GSI,
        KeyConditionExpression=boto3.dynamodb.conditions.Key('bucket_name').eq(bucket),
        ScanIndexForward=False, # descending by total_size
        Limit=1,
    )

    items = resp.get('Items', [])
    return items[0]['total_size'] if items else 0

def _make_plot(points, max_all_time):    # points: list of {ts, total_size}
    if not points:
        # create an empty plot that still shows max line if any
        fig = plt.figure(figsize=(8, 8))
        ax = fig.add_subplot(111)
        ax.set_title('Bucket Size (last 10s)')
        ax.set_xlabel('Timestamp')
        ax.set_ylabel('Size (bytes)')
        if max_all_time:
            ax.axhline(max_all_time, linestyle='--', label=f'Max ever: {max_all_time}')
            ax.legend()
        buf = io.BytesIO()
        fig.tight_layout()
        fig.savefig(buf, format='png')
        buf.seek(0)
        plt.close(fig)
        return buf
    
    xs = [datetime.fromtimestamp(int(p['timestamp'])) for p in points]
    ys = [p['total_size'] for p in points]

    fig = plt.figure(figsize=(16, 8))
    ax = fig.add_subplot(121)
    ax.plot(xs, ys, marker='o')
    for x, y in zip(xs, ys):
        ax.text(x, y, f"({y})", fontsize=12)
    if max_all_time:
        ax.axhline(max_all_time, linestyle='--', label=f'Max ever: {max_all_time}')
        ax.legend()
    
    ax.set_title('Bucket Size (last 10s)')
    ax.set_xlabel('Time')
    ax.set_ylabel('Size (bytes)')

    ax = fig.add_subplot(122)
    ax.plot(xs, ys, marker='o')
    for x, y in zip(xs, ys):
        ax.text(x, y, f"({y})", fontsize=12)
    
    ax.set_title('Bucket Size (last 10s)')
    ax.set_xlabel('Time')
    ax.set_ylabel('Size (bytes)')

    fig.autofmt_xdate()
    fig.tight_layout()
    
    buf = io.BytesIO()
    fig.savefig(buf, format='png')
    buf.seek(0)
    plt.close(fig)
    return buf

def lambda_handler(event, context):
    bucket = BUCKET

    last10 = _query_last_10s(bucket)
    max_all_time = _query_all_time_max_size(bucket)

    png_buf = _make_plot(last10, max_all_time)
    # Upload to S3
    s3.put_object(Bucket=BUCKET, Key=PLOT_KEY, Body=png_buf.getvalue(), ContentType='image/png')

    body = {
        'message': 'Plot created',
        'bucket': bucket,
        'key': PLOT_KEY,
        'last10_point_count': len(last10),
        # 'max_all_time': int(max_all_time),
    }

    return {
        'statusCode': 200,
        'body': json.dumps(body)
    }
