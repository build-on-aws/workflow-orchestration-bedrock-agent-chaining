import json
import logging
import random
import json
import base64
import boto3
import os

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Bedrock client used to interact with APIs around models
bedrock = boto3.client(
    service_name='bedrock', 
    region_name='us-east-1'
)
     
# Bedrock Runtime client used to invoke and question the models
bedrock_runtime = boto3.client(
    service_name='bedrock-runtime', 
    region_name='us-east-1'
)


# Initialize S3 client
s3_client = boto3.client('s3')
s3_bucket = os.environ['CLAIMIMAGE_SUBMITTED_BUCKET']

def lambda_handler(event, context):
    api_path = event['apiPath']
    logger.info('API Path')
    logger.info(api_path)
    logger.info('Lambda Event Request:')
    logger.info(json.dumps(event))
    
    if api_path == '/detect_damage':
        print(event['requestBody']['content']['application/json']['properties'])
        data = {
        "claim_id": "",
        "image_path": ""
        }
        
        # Extracting damage details from the parsed JSON
        print(event['requestBody']['content']['application/json']['properties'])
        for damage_detail in event['requestBody']['content']['application/json']['properties']:
            if damage_detail['type'] == 'string':
                data[damage_detail['name']] = damage_detail['value']
            else:
                data[damage_detail['name']] = json.loads(damage_detail['value'])
        claim_id = data['claim_id']           
        image_path = data['image_path']
        
        s3_object_key = image_path
        s3_response = s3_client.get_object(Bucket=s3_bucket, Key=s3_object_key)
        s3_data = s3_response['Body'].read()
        s3_data_base64 = base64.b64encode(s3_data).decode('utf-8')
        
        # Construct the JSON body
        body = json.dumps(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 1000,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": "image/jpeg",
                                    "data": s3_data_base64,
                                },
                            },
                            {"type": "text", "text": "Explain in detail the summary of the damages in this image?"},
                        ],
                    }
                ],
            }
        )

        # Invoke the model
        response = bedrock_runtime.invoke_model(
            modelId="anthropic.claude-3-sonnet-20240229-v1:0",
            body=body
        )
        
        # Process the response
        response_body = json.loads(response.get("body").read())
        print("Summary of damages:", response_body['content'][0]['text'])
        
        # Construct your response
        body = { "damage_description": response_body['content'][0]['text']}
        
    else:
        body = {"message": "{} is not a valid API. Please try another one.".format(api_path)}

    response_body = {
        'application/json': {
            'body': json.dumps(body)
        }
    }
        
    action_response = {
        'actionGroup': event['actionGroup'],
        'apiPath': event['apiPath'],
        'httpMethod': event['httpMethod'],
        'httpStatusCode': 200,
        'responseBody': response_body
    }

    api_response = {
        'messageVersion': '1.0', 
        'response': action_response
    }
        
    return api_response
