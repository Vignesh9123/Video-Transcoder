import {S3Client} from '@aws-sdk/client-s3';
import { SQSClient, ReceiveMessageCommand , DeleteMessageCommand} from '@aws-sdk/client-sqs';
import dotenv from 'dotenv';

dotenv.config();

const s3Client = new S3Client({
    region: 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
    }
});

const sqsClient = new SQSClient({
    region: 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
    }
});


async function init(){
    const command = new ReceiveMessageCommand({
        QueueUrl: process.env.SQS_URL,
        MaxNumberOfMessages: 1,
        VisibilityTimeout: 0,
        WaitTimeSeconds: 10
    });
    console.log('Waiting for messages');

    while(true){
        console.log('Waiting for messages 2');
        const response = await sqsClient.send(command);
        if(response.Messages){
            const message = response.Messages[0];
            console.log(message);
            console.log(message.Body)
            const deleteCommand = new DeleteMessageCommand({
                QueueUrl: process.env.SQS_URL,
                ReceiptHandle: message.ReceiptHandle
            })
            await sqsClient.send(deleteCommand)
        }
        // Validation
        // Spin up containers

        
        else{
            console.log('No messages');
            continue
        }
    }

}
init()