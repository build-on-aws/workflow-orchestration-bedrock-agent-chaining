import json
import logging
import boto3
import os

# Initialize the SQS client
sqs_client = boto3.client('sqs')
queue_url = os.environ['NOTIFICATION_QUEUE_URL']

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def send_to_sqs(message_body):
    # Send message to SQS queue
    sqs_client.send_message(
        QueueUrl=queue_url,
        MessageBody=json.dumps(message_body)
    )

def lambda_handler(event, context):
    api_path = event['apiPath']
    logger.info('API Path')
    logger.info(api_path)
    logger.info('Lambda Event Request:')
    logger.info(json.dumps(event))
    
    if api_path == '/send_notification':
        
        data = {
            "claim_id": "",
            "damage_description": ""
        }

        # Extract data from the event
        print(event['requestBody']['content']['application/json']['properties'])
        for summarized_damage_analysis in event['requestBody']['content']['application/json']['properties']:
            if summarized_damage_analysis['type'] == 'string':
                data[summarized_damage_analysis['name']] = summarized_damage_analysis['value']
            else:
                data[summarized_damage_analysis['name']] = json.loads(summarized_damage_analysis['value'])
        damage_description = data['damage_description']           
        claim_id = data['claim_id'] 
    
        # Send the data to SQS
        send_to_sqs({'claim_id': claim_id, 'damage_description': damage_description})
        body = {"status": "Information sent to Claims Adjuster" }
        
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
