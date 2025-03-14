import {GetObjectCommand, S3Client} from '@aws-sdk/client-s3';
import { SQSClient, ReceiveMessageCommand , DeleteMessageCommand} from '@aws-sdk/client-sqs';
import dotenv from 'dotenv';
import { exec } from "child_process";
import fs from 'fs';
import path from 'path';

dotenv.config();
const imageName = "video-transcoder";


const s3Client = new S3Client({
    region: 'ap-south-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
    }
});

const sqsClient = new SQSClient({
    region: 'ap-south-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
    }
});


async function init(){
    const command = new ReceiveMessageCommand({
        QueueUrl: process.env.SQS_URL,
        MaxNumberOfMessages: 1,
        VisibilityTimeout: 120,
        WaitTimeSeconds: 10,
    });
    console.log('Waiting for messages');

    while(true){
        console.log('Waiting for messages 2');
        const response = await sqsClient.send(command);
        if(response.Messages){
            const message = response.Messages[0];
            // console.log(message);
            // console.log(message.Body)

     // Validation
     const validExtensions = ['.mp4', '.mkv'];
     const record = JSON.parse(message.Body!).Records?.[0]
     if (JSON.parse(message.Body!).Event == 's3:TestEvent' || !validExtensions.includes(path.extname(record.s3.object.key))) {
         console.log('Test event or invalid file type');
    continue;
}

// Spin up containers
const bucket = record.s3.bucket.name
const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '))
const dockercommand = `docker run --rm \
-e AWS_ACCESS_KEY_ID=${process.env.AWS_ACCESS_KEY_ID} \
-e AWS_SECRET_ACCESS_KEY=${process.env.AWS_SECRET_ACCESS_KEY} \
-e AWS_REGION=${'ap-south-1'} \
-e BUCKET=${bucket} \
-e KEY="${key}" \
-e AWS_TRANSCODED_OUTPUT_BUCKET_NAME=${process.env.AWS_TRANSCODED_OUTPUT_BUCKET_NAME} \
-v ${path.join(process.cwd(), 'transcoding-container', 'videos')}:/app/videos \
-v ${path.join(process.cwd(), 'transcoding-container', 'transcoded')}:/app/transcoded \
${imageName}`;
// Remove the volume mapping (Used for local testing)
        // console.log('Running command', dockercommand)
const containerProcess = exec(dockercommand);

containerProcess.stdout?.on('data', (data) => { // Used for real time logs from the container as in exec(dockercommand, (err, stdout, stderr) => {}), stdout and stderr are shown after the container exits

    console.log('Container output:', data.toString());
});

containerProcess.stderr?.on('data', (data) => {
    console.log('Container error:', data.toString());
});

containerProcess.on('exit', async(code, signal) => {
    if(code === 0){
        console.log('Container exited successfully');
        const deleteCommand = new DeleteMessageCommand({
            QueueUrl: process.env.SQS_URL,
            ReceiptHandle: message.ReceiptHandle
        })
        await sqsClient.send(deleteCommand)
    }
    else{
        console.log('Container exited with error', code, signal);
    }
})
    .on('error', (error) => {
        console.log('Container Error', error);
    })
    .on('close', (m) => {
        console.log('Container closed', m);
    })

        }

        
        else{
            console.log('No messages');
            continue
        }
    }

}
init()