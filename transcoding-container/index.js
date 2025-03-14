import {GetObjectCommand, S3Client, PutObjectCommand} from '@aws-sdk/client-s3'
import fs from 'fs'
import path  from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import ffmpeg  from 'fluent-ffmpeg'
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const s3Client = new S3Client({
    region: 'ap-south-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
})



// adaptiveBitrateStreaming() is a function that takes a video file as input and generates multiple versions of the video at different resolutions and bitrates but it does not split the video into chunks/segments (which is done in HLSStreaming()).
async function adaptiveBitrateStreaming(){
    const RESOLUTIONS = [
        { name: '720p', width: 1280, height: 720 },
        { name: '480p', width: 854, height: 480 },
        { name: '360p', width: 640, height: 360 }
    ]
    try {
        const command = new GetObjectCommand({
            Bucket:process.env.BUCKET,
            Key:process.env.KEY
        })
        console.log(`Downloading ${process.env.KEY} from ${process.env.BUCKET}`)
        const response = await s3Client.send(command)
        console.log("Downloading completed", process.env.KEY)
        const body = await response.Body.transformToByteArray()
        console.log(`Writing file ${process.env.KEY}`)
        if(!fs.existsSync(path.join(__dirname,'videos'))){
            fs.mkdirSync(path.join(__dirname,'videos'))
        }
        const file = fs.createWriteStream(path.join(__dirname,'videos',process.env.KEY))
        file.write(body)
        file.end()
        console.log(`File written to ${path.join(__dirname,'videos',process.env.KEY)}`)
        const videoPath = path.join(__dirname,'videos',process.env.KEY)
        const promises = RESOLUTIONS.map((resolution) => {
            if(!fs.existsSync(path.join(__dirname,'transcoded'))){
                fs.mkdirSync(path.join(__dirname,'transcoded'))
            }
            const outputPath = path.join(__dirname,'transcoded',`${process.env.KEY.split('.')[0]}-${resolution.name}.mp4`)
            return new Promise((resolve, reject) => ffmpeg(videoPath)
            .output(outputPath)
            .videoCodec('libx264')
            .audioCodec('aac')
            .size(`${resolution.width}x${resolution.height}`)
            .on('end', () => {
                console.log(`Video transcoded to ${outputPath}`)
                resolve(outputPath)
            })
            .on('error', (err) => {
                console.log(`Error transcoding video: ${err.message}`)
            })
            .format('mp4')
            .run()
            )
        })
    
        const results = await Promise.all(promises)
    
        results.forEach(async(result) => {
            const params = {
                Bucket: process.env.AWS_TRANSCODED_OUTPUT_BUCKET_NAME,
                Key: path.basename(result),
                Body: fs.createReadStream(result)
            }
            const command = new PutObjectCommand(params)
            await s3Client.send(command)
            console.log(`Video uploaded to ${params.Bucket}/${params.Key}`)

        })
    } catch (error) {
        console.log('Error in index', error)
    }

}

// adaptiveBitrateStreaming()

async function createHLSStream(videoPath, outputPath) {
    const variants = [
        // {
        //     resolution: { width: 1920, height: 1080 },
        //     bitrate: '5000k',
        //     name: '1080p'
        // },
        {
            resolution: { width: 1280, height: 720 },
            bitrate: '3000k',
            name: '720p'
        },
        {
            resolution: { width: 854, height: 480 },
            bitrate: '1500k',
            name: '480p'
        },
        {
            resolution: { width: 640, height: 360 },
            bitrate: '500k',
            name: '360p'
        }
    ];

    const hlsOutputPath = outputPath.replace('.mp4', '');
    const masterPlaylist = [];
    masterPlaylist.push('#EXTM3U');
    masterPlaylist.push('#EXT-X-VERSION:3');

    const variantPromises = variants.map(variant => {
        return new Promise((resolve, reject) => {
            const variantPath = `${hlsOutputPath}/${variant.name}`;

            if (!fs.existsSync(variantPath)) {
                fs.mkdirSync(variantPath, { recursive: true });
            }
            
            masterPlaylist.push(`#EXT-X-STREAM-INF:BANDWIDTH=${parseInt(variant.bitrate) * 1000},RESOLUTION=${variant.resolution.width}x${variant.resolution.height}`);
            masterPlaylist.push(`${variant.name}/playlist.m3u8`);

            ffmpeg(videoPath)
                .output(`${variantPath}/playlist.m3u8`)
                .videoCodec('libx264')
                .audioCodec('aac')
                .size(`${variant.resolution.width}x${variant.resolution.height}`)
                .videoBitrate(variant.bitrate)
                .addOptions([
                    '-hls_time 10',
                    '-hls_list_size 0',
                    '-hls_segment_type mpegts',
                    '-hls_segment_filename', `${variantPath}/segment%d.ts`,
                    '-f hls',
                    '-profile:v main',
                    '-crf 23',
                    '-preset fast',
                    '-sc_threshold 0',
                    '-g 48',
                    '-keyint_min 48',
                    '-hls_flags delete_segments+append_list',
                ])
                .on('end', () => {
                    console.log(`HLS variant ${variant.name} completed`);
                    resolve();
                })
                .on('error', (err) => {
                    console.error(`Error transcoding ${variant.name}: ${err.message}`);
                    reject(err);
                })
                .run();
        });
    });

    try {
        await Promise.all(variantPromises);

        await fs.promises.writeFile(
            `${hlsOutputPath}/master.m3u8`,
            masterPlaylist.join('\n')
        );

        console.log('HLS transcoding completed with all variants');
        console.log(`Master playlist: ${hlsOutputPath}/master.m3u8`)
        return `${hlsOutputPath}`;
    } catch (error) {
        console.error('Error in HLS transcoding:', error);
        throw error;
    }
}

async function uploadDirectoryToS3(directoryPath, baseKey) {
    const files = await fs.promises.readdir(directoryPath, { withFileTypes: true });
    
    for (const file of files) {
        const fullPath = path.join(directoryPath, file.name);
        
        if (file.isDirectory()) {
            // Recursively upload subdirectories
            await uploadDirectoryToS3(fullPath, path.join(baseKey, file.name));
        } else {
            // Upload file
            const fileStream = fs.createReadStream(fullPath);
            const s3Key = path.join(baseKey, file.name);

            const params = {
                Bucket: process.env.AWS_TRANSCODED_OUTPUT_BUCKET_NAME,
                Key: s3Key.replace(/\\/g, '/'), // Ensure forward slashes for S3 keys
                Body: fileStream,
                ContentType: getContentType(file.name)
            };

            try {
                await s3Client.send(new PutObjectCommand(params));
                console.log(`Uploaded ${s3Key} to S3`);
            } catch (err) {
                console.error(`Error uploading ${s3Key}:`, err);
                throw err;
            }
        }
    }
}

function getContentType(filename) {
    const ext = path.extname(filename).toLowerCase();
    switch (ext) {
        case '.m3u8':
            return 'application/x-mpegURL';
        case '.ts':
            return 'video/MP2T';
        default:
            return 'application/octet-stream';
    }
}

// HLSStreaming() is the function that takes a video file from S3 and transcodes it to HLS format (break the video into smaller chunks and different resolutions) and uploads it to S3
async function HLSStreaming(){
    try {
        const command = new GetObjectCommand({
            Bucket:process.env.BUCKET,
            Key:process.env.KEY
        })
        console.log(`Downloading ${process.env.KEY} from ${process.env.BUCKET}`)
        const response = await s3Client.send(command)
        console.log("Downloading completed", process.env.KEY)
        const body = await response.Body.transformToByteArray()
        console.log(`Writing file ${process.env.KEY}`)
        if(!fs.existsSync(path.join(__dirname,'videos'))){
            fs.mkdirSync(path.join(__dirname,'videos'))
        }
        const file = fs.createWriteStream(path.join(__dirname,'videos',process.env.KEY))
        file.write(body)
        file.end()
        console.log(`File written to ${path.join(__dirname,'videos',process.env.KEY)}`)
        const videoPath = path.join(__dirname,'videos',process.env.KEY)
        const outputPath = path.join(__dirname,'transcoded',`${process.env.KEY.split('.')[0]}.mp4`)
        const hlsPath = await createHLSStream(videoPath, outputPath)
        const baseKey = `${path.basename(hlsPath)}`; // e.g., "videos/video-123"
        
        await uploadDirectoryToS3(hlsPath, baseKey);
        console.log('Successfully uploaded all HLS files to S3');
    }
    catch(error){
        console.log(error)
    }
}

HLSStreaming()