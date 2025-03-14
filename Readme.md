# Trying to build a Video Transcoder using ffmpeg

## Design
![Video Transcoder](./Video-Transcoder-Design.png)


## Key Points

- Remember to set correct bucket policy to allow public access
- Create a CORS rule to allow cross origin resource sharing in the main (m3u8 file sharing) bucket
- Currently container runs locally, use AWS ECR and ECS for deployment 