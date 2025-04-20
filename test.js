const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const https = require('https');
const http = require('http');
const axios = require('axios');
const AWS = require('aws-sdk');
const os = require('os');
const si = require('systeminformation');
const dotenv = require('dotenv');
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Define base directory constant for consistent path resolution
const baseDir = '/root/VIDEOEDITOR';

dotenv.config({ path: path.join(baseDir, '.env') });

console.log('Environment variables loaded:', {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ? 'Present' : 'Missing',
  secretKey: process.env.AWS_SECRET_ACCESS_KEY ? 'Present' : 'Missing',
  bucket: process.env.AWS_BUCKET_NAME,
  region: process.env.AWS_REGION
});

// Define the animation style at the top of the file
const animation_style = "style_1"; // Statically set the animation style

// Define new variables
//const no_of_words = 4; // Number of words per line
//const font_size = 100; // Font size in pixels (0-128)
//const animation = true; // Set to false to display text without purple animation
//const resolution = "720p"; // Can be "1080p" or "720p"
//const compression = "web"; // Can be "studio", "social_media", or "web"

// Define progression bar variable
//const show_progression_bar = true; // Set to true to show progression bar, false to hide it

const TIMING_EPSILON = 0.005; // 5ms buffer between words for safety

async function downloadFile(url, filepath) {
  console.log(`[DEBUG-AWS] Downloading file from ${url} to ${filepath}`);
  return new Promise((resolve, reject) => {
    if (!url) {
      console.error('[DEBUG-AWS] Invalid URL provided for download');
      reject(new Error('Invalid URL provided'));
      return;
    }

    // Make sure the directory exists
    const dir = path.dirname(filepath);
    try {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`[DEBUG-AWS] Ensured directory exists: ${dir}`);
    } catch (dirError) {
      console.error(`[DEBUG-AWS] Error creating directory ${dir}:`, dirError.message);
    }

    // Check if file already exists
    if (fs.existsSync(filepath)) {
      console.log(`[DEBUG-AWS] File already exists, will be overwritten: ${filepath}`);
      try {
        fs.unlinkSync(filepath);
        console.log(`[DEBUG-AWS] Removed existing file: ${filepath}`);
      } catch (unlinkError) {
        console.error(`[DEBUG-AWS] Error removing existing file:`, unlinkError.message);
      }
    }

    const fileStream = fs.createWriteStream(filepath);
    
    console.log(`[DEBUG-AWS] Starting ${url.startsWith('https') ? 'HTTPS' : 'HTTP'} request`);
    
    const request = (url.startsWith('https') ? https : http).get(url, (response) => {
      console.log(`[DEBUG-AWS] Received response: ${response.statusCode} ${response.statusMessage}`);
      console.log(`[DEBUG-AWS] Response headers:`, response.headers);
      
      if (response.statusCode === 302 || response.statusCode === 301) {
        console.log(`[DEBUG-AWS] Following redirect to: ${response.headers.location}`);
        downloadFile(response.headers.location, filepath)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        const errorMsg = `Request Failed With a Status Code: ${response.statusCode} for URL: ${url}`;
        console.error(`[DEBUG-AWS] ${errorMsg}`);
        fileStream.close();
        fs.unlink(filepath, () => {});
        reject(new Error(errorMsg));
        return;
      }

      const totalSize = parseInt(response.headers['content-length'], 10);
      if (isNaN(totalSize)) {
        console.warn(`[DEBUG-AWS] No content-length header provided for ${url}`);
      } else {
        console.log(`[DEBUG-AWS] Total download size: ${totalSize} bytes`);
      }
      
      let downloadedSize = 0;

      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        if (totalSize) {
          const percentage = (downloadedSize / totalSize * 100).toFixed(2);
          process.stdout.write(`[DEBUG-AWS] Downloading ${path.basename(filepath)}: ${percentage}%, ${downloadedSize}/${totalSize} bytes\r`);
        } else {
          process.stdout.write(`[DEBUG-AWS] Downloading ${path.basename(filepath)}: ${downloadedSize} bytes\r`);
        }
      });

      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`\n[DEBUG-AWS] Downloaded ${path.basename(filepath)}`);
        
        // Verify file exists and has content
        try {
          const stats = fs.statSync(filepath);
          console.log(`[DEBUG-AWS] File size: ${stats.size} bytes`);
          if (stats.size === 0) {
            console.error(`[DEBUG-AWS] Warning: Downloaded file is empty: ${filepath}`);
            fs.unlink(filepath, () => {
              reject(new Error(`Downloaded file is empty: ${filepath}`));
            });
            return;
          }
        } catch (statError) {
          console.error(`[DEBUG-AWS] Error verifying downloaded file:`, statError.message);
        }
        
        resolve(filepath);
      });
    });

    request.on('error', (err) => {
      console.error(`[DEBUG-AWS] Network error during download of ${url}:`, err.message);
      fileStream.close();
      fs.unlink(filepath, () => reject(err));
    });

    fileStream.on('error', (err) => {
      console.error(`[DEBUG-AWS] File system error during download to ${filepath}:`, err.message);
      fileStream.close();
      fs.unlink(filepath, () => reject(err));
    });
    
    // Add timeout to prevent hung downloads
    request.setTimeout(60000, function() {
      console.error(`[DEBUG-AWS] Download timeout for ${url}`);
      request.abort();
      fileStream.close();
      fs.unlink(filepath, () => reject(new Error(`Download timeout for ${url}`)));
    });
  });
}

async function fetchDataFromAPI(text, language = 'en', options = {}, retries = 2, initialDelay = 5000) {
  if (!text || text.trim() === '') {
    console.error('Error: Empty text provided to API');
    throw new Error('Empty text provided to API');
  }

  const {
    videoAssets = 'all',
    animationStyle = '',
    resolution = '1080p',
    compression = 'web',
    noOfWords = 4,
    fontSize = 100,
    animation = true,
    showProgressBar = true,
    watermark = true,
    colorText1 = '#FFFFFF',
    colorText2 = '#000000',
    colorBg = '#FF00FF',
    positionY = 50,
    videoType = 'landscape',
    transcriptionFormat = 'segment',
    ...rest
  } = options;

  let apiUrl = `https://d53fdk5uti.execute-api.us-east-1.amazonaws.com/default/video_1_oct?text=${encodeURIComponent(text)}&transcription_format=${transcriptionFormat}&language=${language}`;
  
  // Add all available parameters with default values
  apiUrl += `&video_assets=${videoAssets}`;
  apiUrl += `&animation_style=${animationStyle}`;
  apiUrl += `&resolution=${resolution}`;
  apiUrl += `&compression=${compression}`;
  apiUrl += `&no_of_words=${noOfWords}`;
  apiUrl += `&font_size=${fontSize}`;
  apiUrl += `&animation=${animation}`;
  apiUrl += `&show_progress_bar=${showProgressBar}`;
  apiUrl += `&watermark=${watermark}`;
  apiUrl += `&color_text1=${encodeURIComponent(colorText1)}`;
  apiUrl += `&color_text2=${encodeURIComponent(colorText2)}`;
  apiUrl += `&color_bg=${encodeURIComponent(colorBg)}`;
  apiUrl += `&position_y=${positionY}`;
  apiUrl += `&video_type=${videoType}`;

  // Add additional language parameters
  if (language !== 'en') {
    if (language === 'hi') apiUrl += '&language=hi';
    if (language === 'ar') apiUrl += '&language=ar';
    if (language === 'te') apiUrl += '&language=te';
    if (language === 'fr') apiUrl += '&language=fr';
  }

  // Add any additional options
  for (const key in rest) {
    apiUrl += `&${key}=${encodeURIComponent(rest[key])}`;
  }

  console.log('Full API URL:', apiUrl);

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      console.log(`Attempt ${attempt + 1} of ${retries}`);
      const response = await axios.get(apiUrl);
      if (response.status === 200) {
        console.log('API response structure:', JSON.stringify(response.data, null, 2));
        
        console.log('Font Name:', response.data.fontName);
        console.log('Font File:', response.data.fontFile);

        if (!response.data.fontFile && options.animationStyle === 'style_3') {
          console.warn('Warning: No font file provided for style_3');
        }

        return response.data;
      }
    } catch (error) {
      console.error(`Attempt ${attempt + 1} failed:`, error.message);
      if (error.response) {
        console.error('Error response:', error.response.data);
      }
      
      if (attempt < retries - 1) {
        const delay = initialDelay * Math.pow(2, attempt);
        console.log(`Waiting ${delay / 1000} seconds before retrying...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  throw new Error(`Failed to fetch data after ${retries} attempts`);
}

function getRandomEffect(videoWidth, videoHeight, duration, isVideo = false) {
  const fps = 30;
  const totalFrames = Math.round(duration * fps);
  
  if (isVideo) {
      // Updated video processing to maintain aspect ratio
      return `scale=${videoWidth*2}:${videoHeight*2}:force_original_aspect_ratio=increase,` +
             `crop=${videoWidth*2}:${videoHeight*2}:x=(in_w-out_w)/2:y=(in_h-out_h)/2,` +
             `zoompan=z='pzoom+0.001':` +
             `x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':` +
             `d=1:s=${videoWidth}x${videoHeight}:fps=${fps},setsar=1`;
  } else {
      // Keep the existing image processing code
      return `zoompan=z='min(zoom+0.0015,1.5)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${videoWidth}x${videoHeight}`;
  }
}

function addImageAnimationsStyle4(videoLoop, videoWidth, videoHeight) {
    let filterComplex = '';
    const fps = 30;
    const directions = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'];
    const transitions = [
        'fade', 'fadeblack', 'fadewhite', 'distance', 'wipeleft', 'wiperight', 'wipeup', 'wipedown',
        'slideleft', 'slideright', 'slideup', 'slidedown', 'circlecrop', 'rectcrop', 'circleopen',
        'circleclose', 'vertopen', 'vertclose', 'horzopen', 'horzclose', 'dissolve'
    ];
    const transitionDuration = 0.8;
    const minimumSegmentDuration = 1.2; // Minimum duration to safely complete a transition

    // Preprocess video segments to ensure minimum duration
    const processedVideoLoop = videoLoop.map(video => {
        const segmentDuration = video.segmentDuration || video.duration;
        return {
            ...video,
            segmentDuration: Math.max(segmentDuration, minimumSegmentDuration)
        };
    });

    processedVideoLoop.forEach((video, i) => {
        const segmentDuration = video.segmentDuration;
        const totalFrames = Math.round(segmentDuration * fps);
        
        if (video.assetType === 'video') {
            // Updated video processing code to maintain aspect ratio
            const direction = directions[Math.floor(Math.random() * directions.length)];
            let zoomFilter = '';
            
            switch (direction) {
                case 'center':
                    zoomFilter = `scale=${videoWidth*2}:${videoHeight*2}:force_original_aspect_ratio=increase,` +
                               `crop=${videoWidth*2}:${videoHeight*2}:x=(in_w-out_w)/2:y=(in_h-out_h)/2,` +
                               `zoompan=z='pzoom+0.001':` +
                               `x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':` +
                               `d=1:s=${videoWidth}x${videoHeight}:fps=${fps},setsar=1`;
                    break;
                case 'top-left':
                    zoomFilter = `scale=${videoWidth*2}:${videoHeight*2}:force_original_aspect_ratio=increase,` +
                               `crop=${videoWidth*2}:${videoHeight*2}:x=(in_w-out_w)/2:y=(in_h-out_h)/2,` +
                               `zoompan=z='pzoom+0.003':` +
                               `d=1:s=${videoWidth}x${videoHeight}:fps=${fps},setsar=1`;
                    break;
                case 'top-right':
                    zoomFilter = `scale=${videoWidth*2}:${videoHeight*2}:force_original_aspect_ratio=increase,` +
                               `crop=${videoWidth*2}:${videoHeight*2}:x=(in_w-out_w)/2:y=(in_h-out_h)/2,` +
                               `zoompan=z='pzoom+0.005':` +
                               `x='iw/2+iw/zoom/2':y='0':` +
                               `d=1:s=${videoWidth}x${videoHeight}:fps=${fps},setsar=1`;
                    break;
                case 'bottom-left':
                    zoomFilter = `scale=${videoWidth*2}:${videoHeight*2}:force_original_aspect_ratio=increase,` +
                               `crop=${videoWidth*2}:${videoHeight*2}:x=(in_w-out_w)/2:y=(in_h-out_h)/2,` +
                               `zoompan=z='pzoom+0.003':` +
                               `y='${videoHeight*2}':` +
                               `d=1:s=${videoWidth}x${videoHeight}:fps=${fps},setsar=1`;
                    break;
                case 'bottom-right':
                    zoomFilter = `scale=${videoWidth*2}:${videoHeight*2}:force_original_aspect_ratio=increase,` +
                               `crop=${videoWidth*2}:${videoHeight*2}:x=(in_w-out_w)/2:y=(in_h-out_h)/2,` +
                               `zoompan=z='pzoom+0.003':` +
                               `x='iw/2+iw/zoom/2':y='${videoHeight*2}':` +
                               `d=1:s=${videoWidth}x${videoHeight}:fps=${fps},setsar=1`;
                    break;
            }
            
            if (i === processedVideoLoop.length - 1) {
                filterComplex += `[${i}:v]${zoomFilter},setpts=PTS-STARTPTS+0.5/TB,tpad=stop_mode=clone:stop_duration=2[v${i}];`;
            } else {
                filterComplex += `[${i}:v]${zoomFilter},setpts=PTS-STARTPTS[v${i}];`;
            }
        } else {
            // Keep existing image processing code
            const zoomFactor = 1.2;
            const zoomIncrement = (zoomFactor - 1) / totalFrames;
            
            // Ensure cropping is done from the center of the image
            let moveFilter = `scale=${videoWidth*2}:${videoHeight*2}:force_original_aspect_ratio=increase,` +
                           `crop=${videoWidth*2}:${videoHeight*2}:x=(in_w-out_w)/2:y=(in_h-out_h)/2,` +
                           `zoompan=z='1+${zoomIncrement}*on':`;
            
            const direction = directions[Math.floor(Math.random() * directions.length)];
            switch (direction) {
                case 'center':
                    moveFilter += `x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2'`;
                    break;
                case 'top-left':
                    moveFilter += `x='0':y='0'`;
                    break;
                case 'top-right':
                    moveFilter += `x='iw-iw/zoom':y='0'`;
                    break;
                case 'bottom-left':
                    moveFilter += `x='0':y='ih-ih/zoom'`;
                    break;
                case 'bottom-right':
                    moveFilter += `x='iw-iw/zoom':y='ih-ih/zoom'`;
                    break;
            }
            
            if (i === processedVideoLoop.length - 1) {
                const extendedDuration = totalFrames + fps * 2;
                filterComplex += `[${i}:v]${moveFilter}:d=${extendedDuration}:s=${videoWidth}x${videoHeight},setsar=1,fps=${fps}[v${i}];`;
            } else {
                filterComplex += `[${i}:v]${moveFilter}:d=${totalFrames}:s=${videoWidth}x${videoHeight},setsar=1,fps=${fps}[v${i}];`;
            }
        }
    });

    if (processedVideoLoop.length > 1) {
        let lastOutput = 'v0';
        let cumulativeDuration = 0;
        
        for (let i = 1; i < processedVideoLoop.length; i++) {
            const prevSegmentDuration = processedVideoLoop[i-1].segmentDuration;
            
            // Use simpler transition options for safer compatibility
            const simpleTransitions = ['fade', 'fadeblack', 'fadewhite', 'wipeleft', 'wiperight'];
            // Use only fade for the last segment transition
            const randomTransition = (i === processedVideoLoop.length - 1) ? 'fade' : 
                simpleTransitions[Math.floor(Math.random() * simpleTransitions.length)];
            
            // Fixed transition duration - no calculations
            const fixedTransDuration = 0.5;
            
            // Ensure offset is safely within the previous segment
            const safeOffset = Math.max(
                cumulativeDuration + 0.1, // Always at least 0.1s into cumulative time
                cumulativeDuration + prevSegmentDuration - fixedTransDuration - 0.1 // Safely before end
            );
            
            filterComplex += `[${lastOutput}][v${i}]xfade=transition=${randomTransition}:duration=${fixedTransDuration}:offset=${safeOffset}[xf${i}];`;
            
            lastOutput = `xf${i}`;
            cumulativeDuration += prevSegmentDuration;
        }
        
        filterComplex += `[${lastOutput}]format=yuv420p[outv];`;
    } else {
        filterComplex += `[v0]format=yuv420p[outv];`;
    }

    return filterComplex;
}

// Add this new function for style_2 image animations
function addImageAnimationsStyle2(videoLoop, videoWidth, videoHeight) {
    let filterComplex = '';
    const fps = 30;
    const directions = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'];
    const minimumSegmentDuration = 1.2; // Minimum duration to safely complete a transition

    // Preprocess video segments to ensure minimum duration
    const processedVideoLoop = videoLoop.map(video => ({
        ...video,
        segmentDuration: Math.max(video.segmentDuration || video.duration, minimumSegmentDuration)
    }));
    
    processedVideoLoop.forEach((video, i) => {
        const segmentDuration = video.segmentDuration;
        const totalFrames = Math.round(segmentDuration * fps);
        
        if (video.assetType === 'video') {
            // Updated video processing code to maintain aspect ratio
            const direction = directions[Math.floor(Math.random() * directions.length)];
            let zoomFilter = '';
            
            switch (direction) {
                case 'center':
                    zoomFilter = `scale=${videoWidth*2}:${videoHeight*2}:force_original_aspect_ratio=increase,` +
                               `crop=${videoWidth*2}:${videoHeight*2}:x=(in_w-out_w)/2:y=(in_h-out_h)/2,` +
                               `zoompan=z='pzoom+0.001':` +
                               `x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':` +
                               `d=1:s=${videoWidth}x${videoHeight}:fps=${fps},setsar=1`;
                    break;
                case 'top-left':
                    zoomFilter = `scale=${videoWidth*2}:${videoHeight*2}:force_original_aspect_ratio=increase,` +
                               `crop=${videoWidth*2}:${videoHeight*2}:x=(in_w-out_w)/2:y=(in_h-out_h)/2,` +
                               `zoompan=z='pzoom+0.003':` +
                               `d=1:s=${videoWidth}x${videoHeight}:fps=${fps},setsar=1`;
                    break;
                case 'top-right':
                    zoomFilter = `scale=${videoWidth*2}:${videoHeight*2}:force_original_aspect_ratio=increase,` +
                               `crop=${videoWidth*2}:${videoHeight*2}:x=(in_w-out_w)/2:y=(in_h-out_h)/2,` +
                               `zoompan=z='pzoom+0.005':` +
                               `x='iw/2+iw/zoom/2':y='0':` +
                               `d=1:s=${videoWidth}x${videoHeight}:fps=${fps},setsar=1`;
                    break;
                case 'bottom-left':
                    zoomFilter = `scale=${videoWidth*2}:${videoHeight*2}:force_original_aspect_ratio=increase,` +
                               `crop=${videoWidth*2}:${videoHeight*2}:x=(in_w-out_w)/2:y=(in_h-out_h)/2,` +
                               `zoompan=z='pzoom+0.003':` +
                               `y='${videoHeight*2}':` +
                               `d=1:s=${videoWidth}x${videoHeight}:fps=${fps},setsar=1`;
                    break;
                case 'bottom-right':
                    zoomFilter = `scale=${videoWidth*2}:${videoHeight*2}:force_original_aspect_ratio=increase,` +
                               `crop=${videoWidth*2}:${videoHeight*2}:x=(in_w-out_w)/2:y=(in_h-out_h)/2,` +
                               `zoompan=z='pzoom+0.003':` +
                               `x='iw/2+iw/zoom/2':y='${videoHeight*2}':` +
                               `d=1:s=${videoWidth}x${videoHeight}:fps=${fps},setsar=1`;
                    break;
            }
            
            filterComplex += `[${i}:v]${zoomFilter},setpts=PTS-STARTPTS[v${i}];`;
        } else {
            // Updated image processing with proper aspect ratio handling
            const zoomFactor = 1.2;
            const zoomIncrement = (zoomFactor - 1) / totalFrames;
            
            // Updated image processing with improved center cropping
            let moveFilter = `scale=${videoWidth*2}:${videoHeight*2}:force_original_aspect_ratio=increase,` +
                           `crop=${videoWidth*2}:${videoHeight*2}:x=(in_w-out_w)/2:y=(in_h-out_h)/2,` +
                           `zoompan=z='1+${zoomIncrement}*on':`;
            
            const direction = directions[Math.floor(Math.random() * directions.length)];
            switch (direction) {
                case 'center':
                    moveFilter += `x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2'`;
                    break;
                case 'top-left':
                    moveFilter += `x='0':y='0'`;
                    break;
                case 'top-right':
                    moveFilter += `x='iw-iw/zoom':y='0'`;
                    break;
                case 'bottom-left':
                    moveFilter += `x='0':y='ih-ih/zoom'`;
                    break;
                case 'bottom-right':
                    moveFilter += `x='iw-iw/zoom':y='ih-ih/zoom'`;
                    break;
            }
            
            filterComplex += `[${i}:v]${moveFilter}:d=${totalFrames}:s=${videoWidth}x${videoHeight},setsar=1,fps=${fps}[v${i}];`;
        }
    });

    // Use simpler concat filter instead of complex crossfades
    if (processedVideoLoop.length > 1) {
        filterComplex += processedVideoLoop.map((_, i) => `[v${i}]`).join('') +
            `concat=n=${processedVideoLoop.length}:v=1:a=0,format=yuv420p[outv];`;
    } else {
        filterComplex += `[v0]format=yuv420p[outv];`;
    }

    return filterComplex;
}

// Check resources before middle steps (enhanced for AWS)
async function checkResourcesMiddleStep(operation = 'Processing') {
  const minRAMPercent = 20;
  const maxWaitTime = 60000; // 1 minute max wait
  let waitTime = 5000;
  
  console.log(`[DEBUG-AWS] ${operation} - Checking system resources`);
  
  while (true) {
    const ram = await getAvailableRAM();
    const cpu = await getCPUUsage();
    
    console.log(`[DEBUG-AWS] ${operation} - Resource check: RAM ${ram.percentAvailable.toFixed(2)}% available, CPU ${cpu.total.toFixed(2)}% used`);
    
    // Also check disk space on AWS
    try {
      const { execSync } = require('child_process');
      const diskSpace = execSync('df -h /tmp').toString();
      console.log(`[DEBUG-AWS] ${operation} - Temp directory space:\n${diskSpace}`);
    } catch (diskError) {
      console.error(`[DEBUG-AWS] ${operation} - Failed to check disk space:`, diskError.message);
    }
    
    if (ram.percentAvailable >= minRAMPercent) {
      console.log(`[DEBUG-AWS] ${operation} - Resources OK to proceed`);
      return true;
    }

    console.log(`\n[DEBUG-AWS] ${operation} - RAM constrained (${ram.percentAvailable.toFixed(2)}%), waiting ${waitTime/1000}s...`);
    
    // Log more details about memory
    const memInfo = process.memoryUsage();
    console.log(`[DEBUG-AWS] ${operation} - Node.js memory details:`, {
      rss: (memInfo.rss / 1024 / 1024).toFixed(2) + 'MB',
      heapTotal: (memInfo.heapTotal / 1024 / 1024).toFixed(2) + 'MB',
      heapUsed: (memInfo.heapUsed / 1024 / 1024).toFixed(2) + 'MB',
      external: (memInfo.external / 1024 / 1024).toFixed(2) + 'MB',
    });
    
    await new Promise(resolve => setTimeout(resolve, waitTime));
    waitTime = Math.min(waitTime * 1.5, 30000);

    if (waitTime >= maxWaitTime) {
      console.warn(`[DEBUG-AWS] ${operation} - Proceeding despite low RAM after waiting`);
      return false;
    }
  }
}

// RAM monitoring function with enhanced AWS debugging
async function getAvailableRAM() {
  try {
    const si = require('systeminformation');
    const mem = await si.mem();
    console.log(`[DEBUG-AWS] RAM details: total=${(mem.total/1024/1024/1024).toFixed(2)}GB, used=${(mem.used/1024/1024/1024).toFixed(2)}GB, available=${(mem.available/1024/1024/1024).toFixed(2)}GB`);
    return {
      total: mem.total,
      available: mem.available,
      percentAvailable: (mem.available / mem.total) * 100
    };
  } catch (error) {
    console.error('[DEBUG-AWS] Error getting detailed RAM info:', error);
    // Fallback to process.memoryUsage() if systeminformation fails
    console.log('[DEBUG-AWS] Falling back to basic OS memory functions');
    const total = os.totalmem();
    const free = os.freemem();
    console.log(`[DEBUG-AWS] Basic RAM info: total=${(total/1024/1024/1024).toFixed(2)}GB, free=${(free/1024/1024/1024).toFixed(2)}GB, used=${((total-free)/1024/1024/1024).toFixed(2)}GB`);
    return {
      total: total,
      available: free,
      percentAvailable: (free / total) * 100
    };
  }
}

// CPU monitoring function with enhanced AWS debugging
async function getCPUUsage() {
  try {
    const si = require('systeminformation');
    const cpu = await si.currentLoad();
    console.log(`[DEBUG-AWS] CPU load details: total=${cpu.currentLoad.toFixed(2)}%, user=${cpu.currentLoadUser.toFixed(2)}%, system=${cpu.currentLoadSystem.toFixed(2)}%`);
    return {
      total: cpu.currentLoad,
      user: cpu.currentLoadUser,
      system: cpu.currentLoadSystem
    };
  } catch (error) {
    console.error('[DEBUG-AWS] Error getting detailed CPU info:', error);
    // Fallback to os.loadavg() if systeminformation fails
    console.log('[DEBUG-AWS] Falling back to basic OS CPU functions');
    const [oneMin, fiveMin, fifteenMin] = os.loadavg();
    console.log(`[DEBUG-AWS] Basic CPU load averages: 1min=${oneMin}, 5min=${fiveMin}, 15min=${fifteenMin}`);
    return {
      total: oneMin * 100,
      user: oneMin * 75, // Estimate
      system: oneMin * 25 // Estimate
    };
  }
}

// Wait for CPU usage to drop with AWS-specific debugging
async function waitForCPU(maxCPUPercent = 90, maxWaitTime = 60000) {
  const startTime = Date.now();
  let waitTime = 5000;

  console.log(`[DEBUG-AWS] Monitoring CPU usage (max allowed: ${maxCPUPercent}%)`);

  while (true) {
    const cpu = await getCPUUsage();
    
    if (cpu.total <= maxCPUPercent) {
      console.log(`[DEBUG-AWS] CPU usage at acceptable level: ${cpu.total.toFixed(2)}%`);
      return true;
    }

    console.log(`[DEBUG-AWS] CPU usage too high (${cpu.total.toFixed(2)}%), waiting ${waitTime/1000}s...`);
    
    // Log additional system info
    try {
      const { execSync } = require('child_process');
      console.log(`[DEBUG-AWS] Top processes by CPU:`);
      console.log(execSync('ps aux --sort=-%cpu | head -5').toString());
    } catch (err) {
      console.error('[DEBUG-AWS] Unable to get top processes:', err.message);
    }
    
    await new Promise(resolve => setTimeout(resolve, waitTime));
    
    if (Date.now() - startTime > maxWaitTime) {
      console.warn('[DEBUG-AWS] Maximum CPU wait time exceeded');
      return false;
    }
    
    waitTime = Math.min(waitTime * 1.5, 30000);
  }
}

// Add this function for continuous resource monitoring during FFmpeg
async function monitorFFmpegResources(operation = 'FFmpeg', minRAMPercent = 20) {
  let checkInterval;
  let shouldPause = false;

  return {
    start: () => {
      checkInterval = setInterval(async () => {
        const ram = await getAvailableRAM();
        const cpu = await getCPUUsage();
        
        console.log(`\n${operation} Resource Check - RAM: ${ram.percentAvailable.toFixed(2)}%, CPU: ${cpu.total.toFixed(2)}%`);
        
        if (ram.percentAvailable < minRAMPercent || cpu.total > 90) {
          shouldPause = true;
          console.log(`\n${operation} - Resources constrained, pausing...`);
        }
      }, 5000); // Check every 5 seconds
    },
    stop: () => {
      if (checkInterval) {
        clearInterval(checkInterval);
      }
    },
    shouldPause: () => shouldPause,
    waitIfNeeded: async () => {
      if (shouldPause) {
        console.log('Waiting for resources to free up...');
        await new Promise(resolve => setTimeout(resolve, 30000)); // 30 second pause
        shouldPause = false;
      }
    }
  };
}

// Modify generateVideo to include resource checks at critical points
async function generateVideo(text, language = 'en', style = 'style_1', options = {}) {
  const startTime = Date.now();
  console.log(`[DEBUG-AWS] Starting video generation for language: ${language}, style: ${style}`);
  console.log(`[DEBUG-AWS] Running on AWS with Node ${process.version}, platform: ${process.platform}`);
  console.log(`[DEBUG-AWS] Available memory: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)}GB, Free memory: ${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)}GB`);
  
  // Log all provided options
  console.log(`[DEBUG-AWS] Options:`, JSON.stringify(options, null, 2));
  
  try {
    if (!text || text.trim() === '') {
      console.error('[DEBUG-AWS] Error: Empty text provided');
      throw new Error('Empty text provided for video generation');
    }

    console.log('[DEBUG-AWS] Checking ffmpeg installation...');
    try {
      const ffmpegPath = process.env.FFMPEG_PATH || '/usr/local/bin/ffmpeg/ffmpeg';
      const { execSync } = require('child_process');
      const ffmpegVersion = execSync(`${ffmpegPath} -version`).toString().split('\n')[0];
      console.log(`[DEBUG-AWS] FFmpeg version: ${ffmpegVersion}`);
    } catch (ffmpegError) {
      console.error('[DEBUG-AWS] FFmpeg check failed:', ffmpegError.message);
    }

    console.log('[DEBUG-AWS] Fetching data from API...');
    let apiData;
    try {
      apiData = await fetchDataFromAPI(text, language, options);
      console.log('[DEBUG-AWS] API data received successfully');
    } catch (apiError) {
      console.error('[DEBUG-AWS] API fetch error:', apiError.message);
      throw apiError;
    }

    // Check if apiData is valid
    if (!apiData || typeof apiData !== 'object') {
      console.error('[DEBUG-AWS] Invalid API response format:', apiData);
      throw new Error('Invalid API response ');
    }

    // Rest of original function follows...
    console.log('API Data:', JSON.stringify(apiData, null, 2));

    // Extract data from API response - FIXED color property destructuring
    let {
      videos: apiVideos,
      voiceoverUrl: audio_link,
      videoType: video_type,
      noOfWords: no_of_words,
      fontSize: font_size,
      animation,
      resolution,
      compression,
      showProgressBar: show_progression_bar,
      watermark,
      watermarkIcon: logo_url,
      color_text1: colorText1, // Fix: correctly map from snake_case to camelCase
      color_text2: colorText2, // Fix: correctly map from snake_case to camelCase
      color_bg: colorBg,       // Fix: correctly map from snake_case to camelCase
      positionY,
      duration: apiDuration,
      words,
      fontFile,
      bg_music_file: backgroundMusicUrl,
    } = apiData;

    // Check for and apply color values from options if available
    colorText1 = options.colorText1 || colorText1 || '#FFFFFF';
    colorText2 = options.colorText2 || colorText2 || '#000000';
    colorBg = options.colorBg || colorBg || '#FF00FF';

    // Log color values to verify they're being used
    console.log('Using colors:', { colorText1, colorText2, colorBg });

    // Check if apiVideos is undefined or not an array
    if (!apiVideos || !Array.isArray(apiVideos)) {
      console.error('API did not return a valid videos array. Using assets instead.');
      apiVideos = apiData.assets || [];
    }

    if (apiVideos.length === 0) {
      throw new Error('No video or image assets provided by API');
    }

    // Convert string values to appropriate types
    no_of_words = parseInt(options.no_of_words || no_of_words); // Strictly use the provided number of words
    font_size = parseInt(font_size);
    animation = animation === 'true' || animation === true;
    show_progression_bar = show_progression_bar === 'true';
    watermark = watermark === 'true';
    positionY = parseInt(positionY);

    // Ensure no_of_words is at least 1
    no_of_words = Math.max(1, no_of_words);
    console.log('Using number of words:', no_of_words);

    // Calculate required duration based on text length
    const wordsPerMinute = 150; // Average reading speed
    const wordCount = text.split(' ').length;
    const requiredDuration = Math.max((wordCount / wordsPerMinute) * 60, apiDuration);
    
    console.log('Text word count:', wordCount);
    console.log('Required duration:', requiredDuration);

    const video_details = apiVideos.map(asset => ({
      url: asset.assetUrl || asset.videoUrl,
      duration: parseFloat(asset.videoDuration || asset.segmentDuration),
      segmentDuration: parseFloat(asset.segmentDuration),
      assetType: asset.assetUrl ? (asset.assetUrl.toLowerCase().endsWith('.mp4') ? 'video' : 'image') : 'video',
      segmentStart: parseFloat(asset.segmentStart),
      segmentEnd: parseFloat(asset.segmentEnd),
      transcriptionPart: asset.transcriptionPart
    }));

    console.log('Video details:', JSON.stringify(video_details, null, 2));

    // Calculate base duration first
    let baseDuration = video_details.reduce((sum, video) => sum + video.segmentDuration, 0);
    
    // Log segment details for debugging
    console.log('Text segments received from API:');
    video_details.forEach((video, index) => {
      console.log(`Segment ${index + 1}:`, {
        text: video.transcriptionPart,
        start: video.segmentStart,
        end: video.segmentEnd,
        duration: video.segmentDuration
      });
    });

    // Modify the transcription details creation to not add extra time for last segment
    const transcription_details = video_details.map((video, index, array) => {
      const segmentWordCount = video.transcriptionPart.split(' ').length;
      const wordsPerSecond = 2;
      const neededDuration = segmentWordCount / wordsPerSecond;

      if (index === array.length - 1) {
        // For last segment, use exact duration without extra buffer
        return {
          start: video.segmentStart,
          end: video.segmentEnd, // Use exact end time
          text: video.transcriptionPart,
          words: words ? words.filter(word => word.start >= video.segmentStart) : [],
          isLastSegment: true,
          segmentDuration: video.segmentDuration
        };
      }

      return {
        start: video.segmentStart,
        end: video.segmentEnd,
        text: video.transcriptionPart,
        words: words ? words.filter(word => word.start >= video.segmentStart && word.end <= video.segmentEnd) : [],
        isLastSegment: false,
        segmentDuration: video.segmentDuration
      };
    });

    // Update total duration based on last segment without extra buffer
    const lastSegment = transcription_details[transcription_details.length - 1];
    const totalDuration = lastSegment.end;
    
    // Calculate precise duration based on timing
    const preciseDuration = Math.max(
      totalDuration,
      transcription_details.reduce((sum, segment) => Math.max(sum, segment.end), 0)
    );
    
    console.log('Final transcription details:', JSON.stringify(transcription_details, null, 2));
    console.log('Total duration:', totalDuration);
    console.log('Precise duration for progress bar:', preciseDuration);

    console.log('Starting video generation process...');
    ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || '/usr/local/bin/ffmpeg/ffmpeg'); // Use FFMPEG_PATH from .env or default to system ffmpeg

    // Set video dimensions based on resolution and video_type
    let videoWidth, videoHeight;
    switch (resolution) {
      case "720p":
        if (video_type === "landscape") {
          videoWidth = 1280;
          videoHeight = 720;
        } else if (video_type === "square") {
          videoWidth = videoHeight = 720;
        } else { // portrait
          videoWidth = 720;
          videoHeight = 1280;
        }
        break;
      case "1080p":
      default:
        if (video_type === "landscape") {
          videoWidth = 1920;
          videoHeight = 1080;
        } else if (video_type === "square") {
          videoWidth = videoHeight = 1080;
        } else { // portrait
          videoWidth = 1080;
          videoHeight = 1920;
        }
        break;
    }

    console.log(`Video dimensions set to: ${videoWidth}x${videoHeight} (${video_type})`);

    const tempDir = path.join(baseDir, 'temp');
    await fsp.mkdir(tempDir, { recursive: true });
    console.log('Temporary directory created:', tempDir);

    // Create style-specific subfolder
    const styleFolder = path.join(baseDir, 'output', style);
    await fsp.mkdir(styleFolder, { recursive: true });
    console.log(`Style folder created: ${styleFolder}`);

    // Declare outputPath at the beginning of the function
    let outputPath;

    // Assign value to outputPath
    outputPath = path.join(styleFolder, `final_video_${language}_${style}.mp4`);

    const outputDir = path.dirname(outputPath);
    await fsp.mkdir(outputDir, { recursive: true });
    console.log('Output directory created:', outputDir);

    // Check resources before downloading assets
    await checkResourcesMiddleStep('Asset Download');
    
    // Filter based on video_assets type
    console.log(`[DEBUG-AWS] Raw API videos count: ${apiVideos ? apiVideos.length : 0}`);
    console.log(`[DEBUG-AWS] Video assets type requested: ${options.videoAssets || 'all'}`);
    
    const filteredAssets = video_details.filter(asset => {
      if (!asset.url) {
        console.log(`[DEBUG-AWS] Skipping asset with no URL:`, JSON.stringify(asset, null, 2));
        return false;
      }
      const isVideo = asset.url.match(/\.(mp4|mov|avi|mkv|webm)$/i);
      console.log(`[DEBUG-AWS] Asset URL: ${asset.url}, isVideo: ${!!isVideo}`);
      const assetType = options.videoAssets || 'all';
      if (assetType === 'video') return isVideo;
      if (assetType === 'image') return !isVideo;
      return true; // 'all' or undefined
    });

    console.log(`[DEBUG-AWS] Filtered assets count: ${filteredAssets.length}`);
    if (filteredAssets.length === 0) {
      console.error('[DEBUG-AWS] No assets left after filtering');
      throw new Error('No assets available after filtering');
    }

    console.log('[DEBUG-AWS] Starting asset downloads...');
    const videos = await Promise.all(filteredAssets.map(async (asset, index) => {
      if (!asset.url) {
        console.warn(`Warning: Invalid URL for asset ${index}. Skipping.`);
        return null;
      }
      const assetPath = path.join(tempDir, `asset_${index}.${asset.assetType === 'image' ? 'jpg' : 'mp4'}`);
      console.log(`[DEBUG-AWS] Downloading asset ${index}: ${asset.url} to ${assetPath}`);
      try {
        await downloadFile(asset.url, assetPath);
        // Verify downloaded file exists and has content
        const fileStats = await fsp.stat(assetPath).catch(e => null);
        if (!fileStats) {
          console.error(`[DEBUG-AWS] Download failed - file doesn't exist: ${assetPath}`);
          return null;
        }
        console.log(`[DEBUG-AWS] Asset ${index} downloaded successfully, size: ${fileStats.size} bytes`);
        return { path: assetPath, duration: asset.duration, segmentDuration: asset.segmentDuration, assetType: asset.assetType };
      } catch (downloadError) {
        console.error(`[DEBUG-AWS] Error downloading asset ${index}:`, downloadError.message);
        return null;
      }
    }));

    // Filter out null values (skipped videos)
    const validVideos = videos.filter(video => video !== null);

    console.log(`[DEBUG-AWS] Valid videos after download: ${validVideos.length} of ${filteredAssets.length}`);
    if (validVideos.length === 0) {
      throw new Error('No valid videos available for processing after downloading');
    }

    console.log('[DEBUG-AWS] Valid videos:', JSON.stringify(validVideos, null, 2));

    const videoLoop = [];
    let totalVideoDuration = 0;

    // Get audio duration from the API response - ensure precise timing
    const audioDuration = parseFloat(apiData.audio_duration || apiData.duration || 0);
    console.log('Audio duration:', audioDuration);

    // Use exact audio duration with no buffer
    const targetDuration = audioDuration;
    console.log('Target duration:', targetDuration);

    // Add all videos except the last one
    for (let i = 0; i < validVideos.length - 1; i++) {
      videoLoop.push(validVideos[i]);
      totalVideoDuration += parseFloat(validVideos[i].segmentDuration);
    }

    // Handle the last video with exact timing to match audio
    const lastVideo = validVideos[validVideos.length - 1];
    const remainingDuration = Math.max(
        targetDuration - totalVideoDuration,
        parseFloat(lastVideo.segmentDuration || 0)
    );

    // Add the last video with precise duration
    videoLoop.push({
        ...lastVideo,
        segmentDuration: remainingDuration
    });
    totalVideoDuration += remainingDuration;

    console.log('Video loop created with total duration:', totalVideoDuration);
    console.log('Target audio duration:', targetDuration);
    console.log('Difference:', Math.abs(totalVideoDuration - targetDuration));

    // Update transcription to match audio duration without buffer
    const lastTranscription = transcription_details[transcription_details.length - 1];
    lastTranscription.end = targetDuration;
    lastTranscription.duration = lastTranscription.end - lastTranscription.start;

    console.log('Video loop created with total duration:', totalVideoDuration);

    // Update ALL transcription timings to ensure animations play full duration
    const lastIndex = transcription_details.length - 1;
    for (let i = 0; i < transcription_details.length; i++) {
      if (i === lastIndex) {
        // Last segment goes to the end with exact timing
        transcription_details[i].end = targetDuration;
        transcription_details[i].duration = transcription_details[i].end - transcription_details[i].start;
      } else {
        // Adjust other segments proportionally
        const ratio = targetDuration / transcription_details[lastIndex].end;
        transcription_details[i].start *= ratio;
        transcription_details[i].end *= ratio;
        transcription_details[i].duration *= ratio;
      }
    }

    console.log('Updated transcription timings:', transcription_details);

    // Handle font information
    let fontPath;
    let fontName;
    const fontsDir = path.join(baseDir, 'fonts');
    const availableFonts = {
      'PoetsenOne': 'PoetsenOne-Regular.ttf',
      'Shadow': 'Shadow.otf',
      'Sipagimbar': 'Sipagimbar.ttf',
      'Homework': 'Homework.ttf',
      'PlumpPixel': 'Plump-Pixel.ttf',
      'UNDER STORM - Shadow': 'Under-Storm-Shadow.ttf',
      'QueenMisti': 'Queen Misti.otf',
      'ShadowBoxRegular': 'Shadow-Box-Regular.ttf',
      'ShadowSleighScriptPro': 'Shadow-Sleigh-Script-Pro.otf',
      'Tabulai': 'Tabulai.otf'
    };

    if (style === 'style_3' && apiData.fontName) {
      fontName = apiData.fontName;
      const normalizedFontName = fontName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      
      const matchedFont = Object.keys(availableFonts).find(key => 
        key.toLowerCase() === normalizedFontName ||
        key.toLowerCase().includes(normalizedFontName) ||
        normalizedFontName.includes(key.toLowerCase())
      );

      if (matchedFont) {
        fontPath = path.join(fontsDir, availableFonts[matchedFont]);
        console.log(`Using font for style_3: ${fontName} (${fontPath})`);
      } else {
        console.error(`Font file for ${fontName} not found in ${fontsDir}`);
        throw new Error(`Required font ${fontName} for style_3 not found`);
      }
    } else if (style === 'style_2') {
      // Use Shadow font for style_2 for all languages
      console.log('Using Shadow font for style_2');
      fontPath = path.join(fontsDir, 'Shadow.otf');
      fontName = 'Shadow';
    } else {
      // For style_1, use PoetsenOne
      console.log('Using default font (PoetsenOne)');
      fontPath = path.join(fontsDir, 'PoetsenOne-Regular.ttf');
      fontName = 'PoetsenOne';
    }

    // Verify that the font file exists
    if (!fs.existsSync(fontPath)) {
      console.error(`Font file not found: ${fontPath}`);
      throw new Error(`Font file not found: ${fontPath}`);
    }

    const subtitlePath = path.join(tempDir, 'subtitles.ass');
    await createASSSubtitleFile(transcription_details, subtitlePath, no_of_words, font_size, animation, videoWidth, videoHeight, totalDuration, colorText1, colorText2, colorBg, positionY, language, style, video_type, fontName, fontPath, show_progression_bar);

    // Use logo_url instead of hardcoded logo URL
    const logoPath = path.join(tempDir, 'logo.png');
    await downloadFile(logo_url, logoPath);

    // Download the original audio
    const audioPath = path.join(tempDir, 'audio.mp3');
    await downloadFile(audio_link, audioPath);

    // Download and mix background music if provided by API
    let mixedAudioPath = audioPath;
    if (backgroundMusicUrl) {
      console.log('Background music URL provided:', backgroundMusicUrl);
      const bgMusicPath = path.join(tempDir, 'background_music.mp3');
      await downloadFile(backgroundMusicUrl, bgMusicPath);
      console.log('Background music downloaded to:', bgMusicPath);

      // Mix original audio with background music
      mixedAudioPath = path.join(tempDir, 'mixed_audio.mp3');
      await mixAudioWithBackgroundMusic(audioPath, bgMusicPath, mixedAudioPath, totalDuration);
      console.log('Audio mixed with background music:', mixedAudioPath);
    } else {
      console.log('No background music URL provided by API');
    }

    // Use mixed audio if background music was provided, otherwise use original audio
    const extendedAudioPath = path.join(tempDir, 'extended_audio.mp3');
    await extendAudio(mixedAudioPath, extendedAudioPath, totalVideoDuration);
    console.log('Audio extended to exact duration:', totalVideoDuration);

    console.log('[DEBUG-AWS] Starting FFmpeg command...');
    await new Promise(async (resolve, reject) => {
      try {
        let command = ffmpeg();
        
        // Log disk space before starting FFmpeg
        try {
          const { execSync } = require('child_process');
          const diskSpace = execSync('df -h .').toString();
          console.log(`[DEBUG-AWS] Available disk space:\n${diskSpace}`);
        } catch (diskError) {
          console.error('[DEBUG-AWS] Failed to check disk space:', diskError.message);
        }

        // Add inputs for all valid assets
        console.log(`[DEBUG-AWS] Adding ${validVideos.length} video inputs to FFmpeg command`);
        validVideos.forEach((video, index) => {
          console.log(`[DEBUG-AWS] Adding input ${index}: ${video.path}`);
          try {
            // Verify the file exists before adding as input
            if (!fs.existsSync(video.path)) {
              console.error(`[DEBUG-AWS] Input file doesn't exist: ${video.path}`);
              throw new Error(`Input file missing: ${video.path}`);
            }
            command = command.input(video.path);
          } catch (inputError) {
            console.error(`[DEBUG-AWS] Error adding input ${index}:`, inputError.message);
            throw inputError;
          }
        });

        // Add audio input
        console.log(`[DEBUG-AWS] Adding audio input: ${extendedAudioPath}`);
        try {
          if (!fs.existsSync(extendedAudioPath)) {
            console.error(`[DEBUG-AWS] Audio file doesn't exist: ${extendedAudioPath}`);
            throw new Error(`Audio file missing: ${extendedAudioPath}`);
          }
          command = command.input(extendedAudioPath);
        } catch (audioError) {
          console.error('[DEBUG-AWS] Error adding audio input:', audioError.message);
          throw audioError;
        }

        let filterComplex = '';

        // Log which animation style is being used
        console.log(`[DEBUG-AWS] Using animation style: ${style}`);
        
        if (style === 'style_2') {
          console.log('[DEBUG-AWS] Building style_2 filter complex');
          filterComplex = addImageAnimationsStyle2(validVideos, videoWidth, videoHeight);
        } else if (style === 'style_4') {
          console.log('[DEBUG-AWS] Building style_4 filter complex');
          filterComplex = addImageAnimationsStyle4(validVideos, videoWidth, videoHeight);
        } else {
          console.log('[DEBUG-AWS] Building standard filter complex');
          // Simplified approach for non-style_2/4 - just use simple zoom effects and concat
          validVideos.forEach((video, i) => {
              const segmentDuration = video.segmentDuration;
              const zoomEffect = getRandomEffect(videoWidth, videoHeight, segmentDuration, video.assetType === 'video');
              
              console.log(`[DEBUG-AWS] Adding effect for video ${i}, type: ${video.assetType}, duration: ${segmentDuration}`);
              
              if (video.assetType === 'video') {
                  filterComplex += `[${i}:v]scale=${videoWidth*2}:${videoHeight*2}:force_original_aspect_ratio=increase,` +
                                 `crop=${videoWidth*2}:${videoHeight*2}:x=(in_w-out_w)/2:y=(in_h-out_h)/2,` +
                                 `${zoomEffect},setpts=PTS-STARTPTS[v${i}];`;
              } else {
                  filterComplex += `[${i}:v]scale=${videoWidth*2}:${videoHeight*2}:force_original_aspect_ratio=increase,` +
                                 `crop=${videoWidth*2}:${videoHeight*2}:x=(in_w-out_w)/2:y=(in_h-out_h)/2,` +
                                 `${zoomEffect},setsar=1,fps=30[v${i}];`;
              }
          });

          // Use straightforward concat filter for simplicity and reliability
          if (validVideos.length > 1) {
            console.log(`[DEBUG-AWS] Using concat filter for ${validVideos.length} videos`);
            filterComplex += validVideos.map((_, i) => `[v${i}]`).join('') + 
              `concat=n=${validVideos.length}:v=1:a=0,format=yuv420p[outv];`;
          } else {
              console.log('[DEBUG-AWS] Single video, no concat needed');
              filterComplex += `[v0]format=yuv420p[outv];`;
          }
        }

        // Add subtitles for all styles
        console.log(`[DEBUG-AWS] Adding subtitles from ${subtitlePath}`);
        try {
          // Verify subtitle file exists
          if (!fs.existsSync(subtitlePath)) {
            console.error(`[DEBUG-AWS] Subtitle file doesn't exist: ${subtitlePath}`);
            throw new Error(`Subtitle file missing: ${subtitlePath}`);
          }
          
          // Verify font directory exists
          const fontDir = path.dirname(fontPath);
          if (!fs.existsSync(fontDir)) {
            console.error(`[DEBUG-AWS] Font directory doesn't exist: ${fontDir}`);
            throw new Error(`Font directory missing: ${fontDir}`);
          }
          
          filterComplex += `[outv]ass=${subtitlePath}:fontsdir=${fontDir}[outv_sub];`;
        } catch (subtitleError) {
          console.error('[DEBUG-AWS] Error adding subtitles:', subtitleError.message);
          throw subtitleError;
        }

        // Add progression bar filter only if show_progression_bar is true
        if (show_progression_bar) {
          console.log('[DEBUG-AWS] Adding progression bar filter');
          filterComplex += 'color=c=' + colorText2 + ':s=' + videoWidth + 'x56[bar];';
          filterComplex += '[bar]split[bar1][bar2];';
          filterComplex += '[bar1]trim=duration=' + totalDuration + '[bar1];';
          filterComplex += '[bar2]trim=duration=' + totalDuration + ',geq='
            + 'r=\'if(lte(X,W*min(1.01*T/' + totalDuration + ',1)),'
              + parseInt(colorBg.slice(1, 3), 16) + ','
              + parseInt(colorText2.slice(1, 3), 16) + ')\':'
            + 'g=\'if(lte(X,W*min(1.01*T/' + totalDuration + ',1)),'
              + parseInt(colorBg.slice(3, 5), 16) + ','
              + parseInt(colorText2.slice(3, 5), 16) + ')\':'
            + 'b=\'if(lte(X,W*min(1.01*T/' + totalDuration + ',1)),'
              + parseInt(colorBg.slice(5, 7), 16) + ','
              + parseInt(colorText2.slice(5, 7), 16) + ')\''
            + '[colorbar];';
          filterComplex += '[bar1][colorbar]overlay[progressbar];';
          filterComplex += '[outv_sub][progressbar]overlay=0:0[outv_final]';
        } else {
          console.log('[DEBUG-AWS] No progression bar requested');
          filterComplex += '[outv_sub]format=yuv420p[outv_final]';
        }

        console.log("[DEBUG-AWS] Filter complex length:", filterComplex.length);
        console.log("[DEBUG-AWS] Filter complex preview (first 500 chars):", filterComplex.substring(0, 500));
        console.log("[DEBUG-AWS] Filter complex preview (last 500 chars):", filterComplex.substring(filterComplex.length - 500));

        // Validate filter complex before execution
        try {
          console.log('[DEBUG-AWS] Validating filter complex');
          validateFilterComplex(filterComplex);
          console.log('[DEBUG-AWS] Filter complex validation passed');
        } catch (validateError) {
          console.error('[DEBUG-AWS] Filter complex validation failed:', validateError.message);
          throw validateError;
        }

        let outputOptions = [
          '-map', '[outv_final]',
          '-map', `${validVideos.length}:a`,
          '-c:v', 'libx264',
          '-preset', 'medium',
          '-threads', '2',
          '-c:a', 'aac',
          '-shortest',
          '-async', '1',
          '-vsync', '1',
          '-max_interleave_delta', '0',
          '-t', `${totalDuration}`, // Ensure exact duration matching audio
          '-pix_fmt', 'yuv420p', // Explicitly set pixel format
          '-b:v', '2500k'
        ];

        // Modify output options based on compression setting
        switch (compression) {
          case "social_media":
            outputOptions.push('-crf', '23');
            break;
          case "web":
            outputOptions.push('-crf', '28');
            break;
          case "studio":
          default:
            outputOptions.push('-crf', '18');
            break;
        }
        
        console.log(`[DEBUG-AWS] FFmpeg output options:`, outputOptions);
        console.log(`[DEBUG-AWS] Output path: ${outputPath}`);

        // Verify output directory exists and is writable
        try {
          const outputDir = path.dirname(outputPath);
          await fsp.access(outputDir, fs.constants.W_OK);
          console.log(`[DEBUG-AWS] Output directory ${outputDir} is writable`);
        } catch (dirError) {
          console.error(`[DEBUG-AWS] Output directory not writable:`, dirError.message);
          // Try to create it again just to be safe
          await fsp.mkdir(path.dirname(outputPath), { recursive: true });
        }

        command
          .complexFilter(filterComplex)
          .outputOptions(outputOptions)
          .output(outputPath)
          .on('start', function(commandLine) {
            console.log('[DEBUG-AWS] Spawned FFmpeg with command:', commandLine);
          })
          .on('progress', async function(progress) {
            console.log('[DEBUG-AWS] Processing: ' + progress.percent + '% done');
            
            // Check CPU usage every 5% progress
            if (progress.percent % 5 === 0) {
              const { user, system, total } = await getCPUUsage();
              console.log(`[DEBUG-AWS] CPU usage: total=${total.toFixed(2)}%, user=${user.toFixed(2)}%, system=${system.toFixed(2)}%`);
              await waitForCPU(90); // Wait if CPU > 90%
            }
            
            // Existing resource checks
            if (progress.percent % 20 === 0) {
              const ram = await getAvailableRAM();
              console.log(`[DEBUG-AWS] RAM: ${(ram.available / 1024 / 1024 / 1024).toFixed(2)}GB available (${ram.percentAvailable.toFixed(2)}%)`);
              await checkResourcesMiddleStep('FFmpeg Progress');
            }
          })
          .on('stderr', function(stderrLine) {
            console.log('[DEBUG-AWS] FFmpeg stderr:', stderrLine);
          })
          .on('error', function(err, stdout, stderr) {
            console.error('[DEBUG-AWS] FFmpeg error:', err.message);
            console.error('[DEBUG-AWS] Error code:', err.code);
            console.error('[DEBUG-AWS] Error killed:', err.killed);
            console.error('[DEBUG-AWS] Error signal:', err.signal);
            console.error('[DEBUG-AWS] FFmpeg stdout:', stdout);
            console.error('[DEBUG-AWS] FFmpeg stderr:', stderr);
            
            // Check if this is the 234 exit code
            if (err.code === 234) {
              console.error('[DEBUG-AWS] Detected exit code 234 - likely resource constraints or permissions issue');
              // Check memory
              const memInfo = process.memoryUsage();
              console.error('[DEBUG-AWS] Node.js memory usage:', {
                rss: (memInfo.rss / 1024 / 1024).toFixed(2) + 'MB', 
                heapTotal: (memInfo.heapTotal / 1024 / 1024).toFixed(2) + 'MB',
                heapUsed: (memInfo.heapUsed / 1024 / 1024).toFixed(2) + 'MB'
              });
            }
            
            reject(err);
          })
          .on('end', async () => {
            console.log('[DEBUG-AWS] Video processing finished');
            // Verify the output file exists and has content
            try {
              const stats = await fsp.stat(outputPath);
              console.log(`[DEBUG-AWS] Output file created successfully, size: ${stats.size} bytes`);
              if (stats.size < 1000) {
                console.warn('[DEBUG-AWS] Warning: Output file is very small!');
              }
            } catch (statError) {
              console.error('[DEBUG-AWS] Failed to verify output file:', statError.message);
            }
            
            // Clean up temporary files except subtitles
            console.log('[DEBUG-AWS] Cleaning up temporary files');
            for (const video of validVideos) {
              await fsp.unlink(video.path).catch(err => {
                console.error(`[DEBUG-AWS] Error deleting ${video.path}:`, err.message);
              });
            }
            await fsp.unlink(audioPath).catch(err => {
              console.error(`[DEBUG-AWS] Error deleting ${audioPath}:`, err.message);
            });
            if (watermark) {
              await fsp.unlink(logoPath).catch(err => {
                console.error(`[DEBUG-AWS] Error deleting ${logoPath}:`, err.message);
              });
            }
            resolve();
          })
          .run();
      } catch (error) {
        console.error('[DEBUG-AWS] Error in video processing:', error);
        reject(error);
      }
    });

    // Store API requirements after successful video generation
    await storeAPIRequirements(language, style, apiData, outputPath, fontPath, totalVideoDuration);

    // Check resources before S3 upload
    await checkResourcesMiddleStep('S3 Upload');
    try {
      // Verify file exists before attempting upload
      const videoPath = path.join(baseDir, 'output', style, `final_video_${language}_${style}.mp4`);
      console.log('Checking video file:', videoPath);
      
      const fileExists = await verifyFile(videoPath);
      if (!fileExists) {
        throw new Error(`Video file not found at path: ${videoPath}`);
      }

      // Read file content only if file exists
      console.log('Reading video file for S3 upload...');
      const fileContent = await fsp.readFile(videoPath);
      console.log('File content read successfully, size:', fileContent.length, 'bytes');

      const random_id = Math.floor(Math.random() * Date.now());
      const s3Key = `video_file/api/${style}/video-${language}-${style}-${random_id}.mp4`;

      console.log('Starting S3 upload with key:', s3Key);
      console.log('Using AWS credentials:', {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        bucket: process.env.AWS_BUCKET_NAME,
        region: process.env.AWS_REGION
      });

      const uploadResult = await s3.upload({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: s3Key,
        Body: fileContent,
        ContentType: 'video/mp4'
      }, {
        partSize: 5 * 1024 * 1024,
        queueSize: 1
      }).promise();

      console.log('Video uploaded successfully:', uploadResult.Location);

      // Clean up local file after successful upload
      await fsp.unlink(videoPath).catch(console.error);
      console.log('Local video file deleted');

      return uploadResult.Location;
    } catch (error) {
      console.error('Error in S3 upload process:', error);
      const videoPath = path.join(baseDir, 'output', style, `final_video_${language}_${style}.mp4`);
      console.log('Falling back to local video path:', videoPath);
      return videoPath;
    }

    return outputPath;
  } catch (error) {
    console.error(`Error in generateVideo for ${language}, ${style}:`, error.message);
    if (error.response && error.response.data) {
      console.error('API Error Details:', error.response.data);
    }
    throw error;
  } finally {
    const endTime = Date.now();
    const totalTime = (endTime - startTime) / 1000;
    console.log(`\nTotal video generation time: ${totalTime.toFixed(2)} seconds`);
  }
}

async function createASSSubtitleFile(transcription_details, outputPath, no_of_words, font_size, animation, videoWidth, videoHeight, actualDuration, colorText1, colorText2, colorBg, positionY, language, style, video_type, fontName, fontPath, show_progression_bar) {
  const assHeader = `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoWidth} 
PlayResY: ${videoHeight}
Aspect Ratio: ${videoWidth}:${videoHeight}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${font_size},&H${colorText1.slice(1).match(/../g).reverse().join('')},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  let assContent = assHeader;
  const barHeight = Math.round(videoHeight * 0.02); // 2% of video height
  const centerY = video_type === "square" 
    ? videoHeight / 2 
    : (videoHeight * positionY) / 100;

  // Adjust centerY to account for the progression bar
  const adjustedCenterY = show_progression_bar 
    ? Math.max(centerY, barHeight + font_size / 2) 
    : centerY;

  const centerX = videoWidth / 2;
  const wordSpacing = 0.1;
  const maxWidth = videoWidth - 20;

  let allWords = transcription_details.flatMap((segment, segmentIndex) => {
    // First check if we have valid segment timing
    if (!segment || typeof segment.start !== 'number' || typeof segment.end !== 'number') {
      console.warn(`Invalid segment timing at index ${segmentIndex}, skipping`);
      return [];
    }

    // Ensure segment timing is valid
    const segmentStart = Math.max(0, segment.start);
    const segmentEnd = Math.max(segmentStart + 0.1, segment.end);

    if (segment.words && Array.isArray(segment.words) && segment.words.length > 0) {
      // Process existing word timings
      return segment.words.map(word => ({
        word: word.word || '',
        start: Math.max(segmentStart, word.start || segmentStart),
        end: Math.min(segmentEnd, word.end || segmentEnd)
      }));
    }

    // Generate evenly spaced timings for words
    const words = (segment.text || '').split(' ').filter(w => w.length > 0);
    if (words.length === 0) return [];

    const segmentDuration = segmentEnd - segmentStart;
    const wordDuration = segmentDuration / words.length;
    
    return words.map((word, index) => {
      const wordStart = segmentStart + (index * wordDuration);
      const wordEnd = index === words.length - 1 
        ? segmentEnd 
        : Math.min(segmentEnd, wordStart + wordDuration);
      
      return {
        word,
        start: wordStart,
        end: Math.max(wordStart + 0.1, wordEnd) // Minimum 0.1s duration
      };
    });
  });

  // Sort words by start time and ensure no overlaps
  allWords.sort((a, b) => a.start - b.start);

  let previousEnd = 0;
  allWords = allWords.map((word, index) => {
    // Force sequential timing with epsilon buffer
    const safeStart = Math.max(word.start || 0, previousEnd + TIMING_EPSILON);
    
    // Ensure minimum duration and valid end time
    const safeEnd = Math.max(safeStart + 0.1, word.end || (safeStart + 0.3));
    
    previousEnd = safeEnd;
    
    return {
      word: word.word || '',
      start: safeStart,
      end: safeEnd
    };
  });

  // Add second-pass validation to catch any remaining overlaps
  for (let i = 1; i < allWords.length; i++) {
    if (allWords[i].start <= allWords[i-1].end) {
      console.warn(`Fixing remaining overlap at word ${i}: "${allWords[i].word}"`);
      allWords[i].start = allWords[i-1].end + TIMING_EPSILON;
      allWords[i].end = Math.max(allWords[i].start + 0.1, allWords[i].end);
    }
  }

  console.log('Processed word timings:', allWords.map(w => ({
    word: w.word,
    start: w.start.toFixed(2),
    end: w.end.toFixed(2)
  })));

  let previousSlideEnd = 0;

  if (style === "style_2") {
    for (let i = 0; i < allWords.length;) {
      let slideWords = [];
      let currentLineWidth = 0;
      let lineCount = 0;
  
      while (slideWords.length < no_of_words && i < allWords.length) {
        let nextWord = allWords[i];
        let wordWidth = getTextWidth(nextWord.word, fontName, font_size);
  
        if (currentLineWidth + wordWidth > maxWidth) {
          lineCount++;
          currentLineWidth = wordWidth;
        } else {
          currentLineWidth += wordWidth + wordSpacing;
        }
  
        slideWords.push(nextWord);
        i++;
  
        if (lineCount >= 2) {
          break;
        }
      }
  
      if (slideWords.length === 0) continue;

      // Use exact word timings like in style_1
      const slideStart = slideWords[0].start;
      const slideEnd = slideWords[slideWords.length - 1].end;
  
      let totalWidth = slideWords.reduce((sum, word) => sum + getTextWidth(word.word, fontName, font_size), 0) 
                       + (slideWords.length - 1) * wordSpacing;
      let startX = centerX - (totalWidth / 2);
      let currentX = startX;
      let currentY = centerY - (lineCount * font_size / 2);
  
      let lineContent = '';
      slideWords.forEach((word, wordIndex) => {
        const wordWidth = getTextWidth(word.word, fontName, font_size);
        
        // Use exact word timing for each word
        const wordStart = word.start;
        const wordEnd = word.end;
        
        lineContent += `{\\k${Math.round((wordEnd - wordStart) * 100)}` +
          `\\1c&H${colorText1.slice(1).match(/../g).reverse().join('')}&` +
          `\\3c&H${colorText2.slice(1).match(/../g).reverse().join('')}&` +
          `\\t(${Math.round((wordStart - slideStart) * 1000)},` +
          `${Math.round((wordEnd - slideStart) * 1000)},` +
          `\\1c&H${colorBg.slice(1).match(/../g).reverse().join('')}&` +
          `\\3c&H${colorText1.slice(1).match(/../g).reverse().join('')}&)}${word.word} `;
  
        currentX += wordWidth + wordSpacing;
      });
  
      assContent += `Dialogue: 0,${formatASSTime(slideStart)},${formatASSTime(slideEnd)},` +
        `Default,,0,0,0,,{\\an5\\pos(${centerX},${adjustedCenterY})\\bord2\\shad1}${lineContent.trim()}\n`;
    }
  } else {
    let lastWordEnd = 0;
    for (let i = 0; i < allWords.length;) {
      let slideWords = [];
      let currentLineWidth = 0;
      let lineCount = 0;

      // Start new slide only after previous words end
      while (slideWords.length < no_of_words && 
             i < allWords.length && 
             (slideWords.length === 0 || allWords[i].start >= lastWordEnd)) {
        let nextWord = allWords[i];
        let wordWidth = getTextWidth(nextWord.word, fontName, font_size);

        if (currentLineWidth + wordWidth > maxWidth) {
          lineCount++;
          currentLineWidth = wordWidth;
        } else {
          currentLineWidth += wordWidth + wordSpacing;
        }

        slideWords.push(nextWord);
        i++;

        if (lineCount >= 2) {
          break;
        }
      }

      if (slideWords.length === 0) continue;

      let slideStart = Math.max(slideWords[0].start, previousSlideEnd);
      let slideEnd = slideWords[slideWords.length - 1].end;

      // Ensure slide duration is not negative
      if (slideEnd <= slideStart) {
        slideEnd = slideStart + 0.1;
      }

      previousSlideEnd = slideEnd;
      lastWordEnd = slideEnd;

      let totalWidth = slideWords.reduce((sum, word) => sum + getTextWidth(word.word, fontName, font_size), 0) 
                       + (slideWords.length - 1) * wordSpacing;
      let startX = centerX - (totalWidth / 2);

      let currentX = startX;
      let currentY = centerY - (lineCount * font_size / 2);

      // Render static words for the entire slide duration (base layer)
      for (let j = 0; j < slideWords.length; j++) {
        let word = slideWords[j];
        let wordWidth = getTextWidth(word.word, fontName, font_size);

        if (currentX + wordWidth > centerX + maxWidth / 2) {
          currentX = startX;
          currentY += font_size;
        }

        // Add static text with higher layer number (1) to appear above backgrounds
        assContent += `Dialogue: 1,${formatASSTime(slideStart)},${formatASSTime(slideEnd)},Default,,0,0,0,,` +
          `{\\an5\\pos(${currentX + wordWidth/2},${currentY})\\1c&H${colorText1.slice(1).match(/../g).reverse().join('')}&}${word.word}\n`;

        currentX += wordWidth + wordSpacing;
      }

      // Reset positions for the background rendering
      currentX = startX;
      currentY = centerY - (lineCount * font_size / 2);

      // Then the existing background highlighting code follows...
      if (animation) {
        currentX = startX;
        currentY = centerY - (lineCount * font_size / 2);

        for (let j = 0; j < slideWords.length; j++) {
          let word = slideWords[j];
          let wordWidth = getTextWidth(word.word, fontName, font_size);

          if (currentX + wordWidth > centerX + maxWidth / 2) {
            currentX = startX;
            currentY += font_size;
          }

          // Use strict non-overlapping timing
          const wordStart = j === 0 ? word.start : Math.max(word.start, slideWords[j-1].end + TIMING_EPSILON);
          const wordEnd = Math.max(wordStart + 0.1, word.end);

          // Verify no overlap with next word
          if (j < slideWords.length - 1 && wordEnd >= slideWords[j+1].start) {
            slideWords[j+1].start = wordEnd + TIMING_EPSILON;
          }

          // Modified code with border radius, bottom padding, and pop in/out animation
          const radius = Math.min(14, font_size * 0.2); // Calculate appropriate radius based on font size
          const bottomPadding = Math.ceil(font_size * 0.17); // Add 17% of font size as bottom padding
          const totalHeight = font_size + bottomPadding; // Total height including padding
          
          // Adjust vertical position to shift the highlight downward so padding is at the bottom
          // Since \an5 positioning is center-based, we need to move the center down by half the padding amount
          const adjustedY = currentY + bottomPadding/2;
          
          assContent += `Dialogue: 0,${formatASSTime(wordStart)},${formatASSTime(wordEnd)},Default,,0,0,0,,` +
            `{\\an5\\pos(${currentX + wordWidth/2},${adjustedY})\\bord0\\shad0\\c&H${colorBg.slice(1).match(/../g).reverse().join('')}&` +
            `\\alpha&H40&\\fscx95\\fscy95\\t(0,200,\\fscx105\\fscy105)\\t(${Math.round((wordEnd - wordStart - 0.3) * 1000)},` +
            `${Math.round((wordEnd - wordStart) * 1000)},` +
            `\\fscx50\\fscy50)\\p1}m ${radius} 0 l ${wordWidth-radius} 0 b ${wordWidth-radius/2} 0 ${wordWidth} ${radius/2} ${wordWidth} ${radius} l ${wordWidth} ${totalHeight-radius} ` +
            `b ${wordWidth} ${totalHeight-radius/2} ${wordWidth-radius/2} ${totalHeight} ${wordWidth-radius} ${totalHeight} l ${radius} ${totalHeight} ` +
            `b ${radius/2} ${totalHeight} 0 ${totalHeight-radius/2} 0 ${totalHeight-radius} l 0 ${radius} b 0 ${radius/2} ${radius/2} 0 ${radius} 0{\\p0}\n`;

          currentX += wordWidth + wordSpacing;
        }
      }
    }
  }

  await fsp.writeFile(outputPath, assContent);
  console.log(`ASS subtitle file created at: ${outputPath}`);
  console.log('Subtitle content preview:', assContent.substring(0, 500));
}

function getTextWidth(text, font, fontSize) {
  const avgCharWidth = fontSize * 0.6;
  const narrowChars = (text.match(/[ijl1]/g) || []).length;
  const wideChars = (text.match(/[mwW]/g) || []).length;
  const normalChars = text.length - narrowChars - wideChars;
  
  return Math.ceil((narrowChars * avgCharWidth * 0.5) +
         (wideChars * avgCharWidth * 1.2) +
         (normalChars * avgCharWidth));
}

function formatASSTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const cs = Math.floor((seconds * 100) % 100); // Use centiseconds for better precision
  
  return `${hours.toString().padStart(2, '0')}:` +
         `${minutes.toString().padStart(2, '0')}:` +
         `${secs.toString().padStart(2, '0')}.` +
         `${cs.toString().padStart(2, '0')}`;
}

// Add this new function to generate transcription details from text
function generateTranscriptionDetails(text) {
  const words = text.split(' ');
  let currentTime = 0;
  const wordsPerSegment = 10; // Reduced for better timing
  const wordsPerSecond = 1.5; // Slower speed for better readability
  
  const segments = [];
  for (let i = 0; i < words.length; i += wordsPerSegment) {
    const segmentWords = words.slice(i, i + wordsPerSegment);
    const segmentDuration = Math.ceil(segmentWords.length / wordsPerSecond) + 1; // Add 1 second per segment
    
    segments.push({
      id: segments.length,
      start: currentTime,
      end: currentTime + segmentDuration,
      text: segmentWords.join(' ')
    });
    currentTime += segmentDuration;
  }

  // Add extra time for the last segment
  if (segments.length > 0) {
    const lastSegment = segments[segments.length - 1];
    const lastSegmentWords = lastSegment.text.split(' ').length;
    const extraTime = Math.ceil(lastSegmentWords / wordsPerSecond) + 3; // Add 3 extra seconds for last segment
    lastSegment.end = currentTime + extraTime;
  }

  return segments;
}

// Add this new function to extend the audio
async function extendAudio(inputPath, outputPath, duration) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFilters(`apad=pad_dur=${duration}`)
      .duration(duration)
      .on('error', reject)
      .on('end', resolve)
      .save(outputPath);
  });
}

// Add this function to your test.js file
async function storeAPIRequirements(language, style, apiData, outputPath, fontPath, totalVideoDuration) {
  const styleFolder = path.join(baseDir, 'output', style);
  await fsp.mkdir(styleFolder, { recursive: true });
  const requirementsPath = path.join(styleFolder, `requirements_${language}_${style}.txt`);
  
  let content = 'API Requirements for ' + language.toUpperCase() + ' video (' + style + '):\n';
  content += '--------------------------------------------\n';
  content += 'Text: ' + apiData.fullText + '\n';
  content += 'Language: ' + language + '\n';
  content += 'Animation Style: ' + style + '\n';
  content += 'Video Type: ' + apiData.videoType + '\n';
  content += 'Number of Words: ' + apiData.noOfWords + '\n';
  content += 'Font Size: ' + apiData.fontSize + '\n';
  content += 'Animation: ' + apiData.animation + '\n';
  content += 'Resolution: ' + apiData.resolution + '\n';
  content += 'Compression: ' + apiData.compression + '\n';
  content += 'Show Progress Bar: ' + apiData.showProgressBar + '\n';
  content += 'Watermark: ' + apiData.watermark + '\n';
  content += 'Color Text 1: ' + apiData.colorText1 + '\n';
  content += 'Color Text 2: ' + apiData.colorText2 + '\n';
  content += 'Color Background: ' + apiData.colorBg + '\n';
  content += 'Position Y: ' + apiData.positionY + '\n';
  content += 'Duration: ' + totalVideoDuration + '\n';
  content += 'Output Path: ' + outputPath + '\n';
  if (style === 'style_3') {
    content += 'Font Name: ' + apiData.fontName + '\n';
    content += 'Font Path: ' + fontPath + '\n';
  } else {
    content += 'Font Name: PoetsenOne\n';
    content += 'Font Path: ' + fontPath + '\n';
  }
  content += 'Background Music URL: ' + (apiData.bg_music_file || 'Not provided') + '\n';
  content += '--------------------------------------------\n';

  try {
    await fsp.writeFile(requirementsPath, content);
    console.log(`API requirements stored in: ${requirementsPath}`);
  } catch (error) {
    console.error(`Error writing API requirements: ${error.message}`);
  }
}

// Update the main execution
async function main() {
  const sampleText = "Guys, welcome back to our YouTube channel. Fact, friends, today we're going to talk about whether we can actually time travel, go to the past or future. I know you all have these questions. Let's discuss all this in detail. Before going into the video, please like, share and subscribe to our YouTube channel, friends. Before knowing about time travel, let's first know about time. Where the gravitational force is high, time passes slower. And to do this experiment, two scientists came together for a time mission. That time mission is not like the one shown in movies. It's just a time mission that calculates accurate time. And they took two of these. One was placed in an airplane and the other on Earth. After one round, we could clearly see the time difference in both devices. So, what we clearly understand here is that where the gravitational force is high, time passes a little slower. So this is about time. Now you can understand that everyone has the same understanding of time.";

  const languages = ['en', 'hi', 'ar', 'fr'];
  const styles = ['style_1', 'style_2', 'style_3', 'style_4'];

  for (const lang of languages) {
    for (const style of styles) {
      try {
        console.log(`\n--- Generating video for language: ${lang}, style: ${style} ---`);
        const videoUrl = await generateVideo(sampleText, lang, style);
        console.log(`Video created and uploaded successfully for ${lang}, ${style}: ${videoUrl}`);
      } catch (err) {
        console.error(`Error creating video for ${lang}, ${style}:`, err.message);
        console.log(`Skipping to next combination...\n`);
      }
    }
  }
}

// Export only the generateVideo function
module.exports = { generateVideo };

function validateFilterComplex(filterComplex) {
  console.log('Validating filter complex...');
  
  // Check for common syntax errors
  if (filterComplex.includes(',,') || filterComplex.includes(';;')) {
    throw new Error('Invalid filter complex: contains empty filters');
  }
  
  // Check for mismatched brackets
  if (filterComplex.split('[').length !== filterComplex.split(']').length) {
    throw new Error('Invalid filter complex: mismatched brackets');
  }
  
  // Check for proper zoompan syntax
  const zoompanRegex = /zoompan=z='[^']*'/g;
  const zoompanMatches = filterComplex.match(zoompanRegex);
  if (zoompanMatches) {
    for (const match of zoompanMatches) {
      if (!match.includes("'")) {
        throw new Error('Invalid zoompan filter: missing quotes around expression');
      }
    }
  }
  
  // Check for proper concat syntax
  const concatRegex = /concat=n=\d+:v=\d+:a=\d+/g;
  const concatMatches = filterComplex.match(concatRegex);
  if (concatMatches) {
    for (const match of concatMatches) {
      const nMatch = match.match(/n=(\d+)/);
      if (nMatch) {
        const n = parseInt(nMatch[1]);
        // Count previous filter outputs before concat
        const inputLabels = [];
        const labelRegex = /\[([^\]]+)\]/g;
        let labelMatch;
        while ((labelMatch = labelRegex.exec(filterComplex.substring(0, filterComplex.indexOf(match))))) {
          inputLabels.push(labelMatch[1]);
        }
        
        if (inputLabels.length < n) {
          throw new Error(`Invalid concat filter: expected ${n} inputs but found ${inputLabels.length}`);
        }
      }
    }
  }
  
  // Check for proper xfade syntax
  const xfadeRegex = /xfade=transition=[^:]+:duration=([^:]+):offset=([^:]+)/g;
  const xfadeMatches = filterComplex.match(xfadeRegex);
  if (xfadeMatches) {
    for (const match of xfadeMatches) {
      const durationMatch = match.match(/duration=([^:]+)/);
      const offsetMatch = match.match(/offset=([^:]+)/);
      
      if (durationMatch && offsetMatch) {
        const duration = parseFloat(durationMatch[1]);
        const offset = parseFloat(offsetMatch[1]);
        
        if (isNaN(duration) || duration <= 0) {
          throw new Error(`Invalid xfade filter: invalid duration ${durationMatch[1]}`);
        }
        
        if (isNaN(offset) || offset < 0) {
          throw new Error(`Invalid xfade filter: invalid offset ${offsetMatch[1]}`);
        }
      }
    }
  }
  
  // Check for valid filter references
  const usedLabels = new Set();
  const definedLabels = new Set();
  
  // Find all defined output labels
  const outputLabelRegex = /\[([^\]]+)\];/g;
  let outputMatch;
  while ((outputMatch = outputLabelRegex.exec(filterComplex))) {
    definedLabels.add(outputMatch[1]);
  }
  
  // Find all used input labels
  const inputLabelsRegex = /\[([^\]]+)\]/g;
  let inputMatch;
  const foundInputs = [];
  while ((inputMatch = inputLabelsRegex.exec(filterComplex))) {
    foundInputs.push(inputMatch[1]);
  }
  
  // Check each input to see if it's defined before use
  for (let i = 0; i < foundInputs.length; i++) {
    const label = foundInputs[i];
    // Skip numeric labels (direct inputs) and final output labels
    if (/^\d+:[av]$/.test(label) || label === 'outv' || label === 'outv_sub' || label === 'outv_final') {
      continue;
    }
    
    // Check if this label is defined before this position
    const labelPos = filterComplex.indexOf(`[${label}]`, 0);
    const definedPos = filterComplex.indexOf(`[${label}]`, labelPos + 1);
    
    if (definedPos === -1 && !definedLabels.has(label)) {
      // If it's an input reference (like 0:v), it's ok
      if (!label.match(/^\d+:[av]$/)) {
        usedLabels.add(label);
      }
    }
  }
  
  // Final check for undefined labels
  for (const label of usedLabels) {
    if (!definedLabels.has(label) && !label.match(/^\d+:[av]$/)) {
      throw new Error(`Invalid filter complex: label [${label}] is used but never defined`);
    }
  }
  
  console.log('Filter complex validation passed');
  return true;
}

// Add this file check function
async function verifyFile(filePath) {
  try {
    const stats = await fsp.stat(filePath);
    console.log(`File verified: ${filePath}`);
    console.log(`File size: ${stats.size} bytes`);
    return true;
  } catch (error) {
    console.error(`File verification failed: ${filePath}`);
    console.error(`Error: ${error.message}`);
    return false;
  }
}

// Express middleware
app.use(express.json({ limit: '50mb' }));

app.post('/generate-video', async (req, res) => {
  try {
    console.log('Received request body:', JSON.stringify(req.body, null, 2));
    
    const { 
      text, 
      language = 'en', 
      style = 'style_1',
      video_assets,
      resolution,
      compression,
      no_of_words,
      font_size,
      animation,
      show_progress_bar,
      watermark,
      color_text1,
      color_text2,
      color_bg,
      position_y,
      video_type,
      transcription_format
    } = req.body;

    if (!text) {
      return res.status(400).json({ status: 'error', message: 'Text is required' });
    }

    // Pass all parameters directly in the options object
    const options = {
      videoAssets: video_assets,
      resolution,
      compression,
      noOfWords: no_of_words,
      fontSize: font_size,
      animation,
      showProgressBar: show_progress_bar,
      watermark,
      colorText1: color_text1,
      colorText2: color_text2,
      colorBg: color_bg,
      positionY: position_y,
      videoType: video_type,
      transcriptionFormat: transcription_format
    };

    // Remove undefined values
    Object.keys(options).forEach(key => options[key] === undefined && delete options[key]);

    console.log('Calling generateVideo with:', {
      text,
      language,
      style,
      options
    });

    const videoUrl = await generateVideo(text, language, style, options);

    res.json({
      status: 'success',
      url: videoUrl
    });
  } catch (error) {
    console.error('Error generating video:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

// New function to mix audio with background music
async function mixAudioWithBackgroundMusic(voiceoverPath, bgMusicPath, outputPath, duration) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(voiceoverPath)
      .input(bgMusicPath)
      .inputOptions(['-stream_loop -1'])
      .complexFilter([
        '[0:a]volume=1[voice]',
        '[1:a]volume=0.5[bg]',
        '[voice][bg]amix=inputs=2:duration=first[out]' // Changed to 'first' instead of 'longest'
      ])
      .outputOptions(['-map [out]', '-t', duration])
      .output(outputPath)
      .on('start', (command) => {
        console.log('Started ffmpeg with command:', command);
      })
      .on('end', () => {
        console.log('Audio mixing completed');
        resolve();
      })
      .on('error', (err) => {
        console.error('Error during audio mixing:', err);
        reject(err);
      })
      .run();
  });
}

// Monitor system resources during stress test
async function monitorResources(interval = 5000) {
  let isMonitoring = true;

  const monitor = async () => {
    while (isMonitoring) {
      const ram = await getAvailableRAM();
      const cpu = await getCPUUsage();
      
      console.log('\n=== System Resources ===');
      if (ram) {
        console.log(`RAM Available: ${(ram.available / 1024 / 1024 / 1024).toFixed(2)}GB (${ram.percentAvailable.toFixed(2)}%)`);
      }
      if (cpu) {
        console.log(`CPU Usage: ${cpu.total.toFixed(2)}% (User: ${cpu.user.toFixed(2)}%, System: ${cpu.system.toFixed(2)}%)`);
      }
      
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  };

  monitor();
  return () => { isMonitoring = false; };
}

// Update exports
module.exports = { ...module.exports, getAvailableRAM, getCPUUsage, monitorResources };

// RAM monitoring function
async function getAvailableRAM() {
  try {
    const si = require('systeminformation');
    const mem = await si.mem();
    return {
      total: mem.total,
      available: mem.available,
      percentAvailable: (mem.available / mem.total) * 100
    };
  } catch (error) {
    console.error('Error getting RAM info:', error);
    // Fallback to process.memoryUsage() if systeminformation fails
    const usage = process.memoryUsage();
    return {
      total: os.totalmem(),
      available: os.freemem(),
      percentAvailable: (os.freemem() / os.totalmem()) * 100
    };
  }
}

// CPU monitoring function
async function getCPUUsage() {
  try {
    const si = require('systeminformation');
    const cpu = await si.currentLoad();
    return {
      total: cpu.currentLoad,
      user: cpu.currentLoadUser,
      system: cpu.currentLoadSystem
    };
  } catch (error) {
    console.error('Error getting CPU info:', error);
    // Fallback to os.loadavg() if systeminformation fails
    const [oneMin, fiveMin, fifteenMin] = os.loadavg();
    return {
      total: oneMin * 100,
      user: oneMin * 75, // Estimate
      system: oneMin * 25 // Estimate
    };
  }
}

// Add CPU throttling function
async function waitForCPU(maxCPUPercent = 90, maxWaitTime = 60000) {
  const startTime = Date.now();
  let waitTime = 5000;

  while (true) {
    const cpu = await getCPUUsage();
    
    if (cpu.total <= maxCPUPercent) {
      return true;
    }

    console.log(`CPU usage too high (${cpu.total.toFixed(2)}%), waiting ${waitTime/1000}s...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    
    if (Date.now() - startTime > maxWaitTime) {
      console.warn('Maximum CPU wait time exceeded');
      return false;
    }
    
    waitTime = Math.min(waitTime * 1.5, 30000);
  }
}

// Update S3 configuration with proper error handling
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
  signatureVersion: 'v4',
  correctClockSkew: true
});

// Add S3 upload function with better error handling
async function uploadToS3(fileContent, s3Key) {
  try {
    console.log('Starting S3 upload with credentials:', {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      bucket: process.env.AWS_BUCKET_NAME,
      region: process.env.AWS_REGION
    });

    const uploadResult = await s3.upload({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: s3Key,
      Body: fileContent,
      ContentType: 'video/mp4',
      ACL: 'public-read'
    }, {
      partSize: 5 * 1024 * 1024, // 5MB parts
      queueSize: 1
    }).promise();

    console.log('S3 upload successful:', uploadResult.Location);
    return uploadResult;
  } catch (error) {
    console.error('S3 upload error details:', {
      code: error.code,
      message: error.message,
      region: error.region,
      time: error.time,
      requestId: error.requestId,
      statusCode: error.statusCode
    });
    throw error;
  }
}

// Add this file check function
async function verifyFile(filePath) {
  try {
    const stats = await fsp.stat(filePath);
    console.log(`File verified: ${filePath}`);
    console.log(`File size: ${stats.size} bytes`);
    return true;
  } catch (error) {
    console.error(`File verification failed: ${filePath}`);
    console.error(`Error: ${error.message}`);
    return false;
  }
}
