const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const https = require('https');
const http = require('http');
const axios = require('axios');
const AWS = require('aws-sdk');

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

async function downloadFile(url, filepath) {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error('Invalid URL provided'));
      return;
    }

    const fileStream = fs.createWriteStream(filepath);
    
    const request = (url.startsWith('https') ? https : http).get(url, (response) => {
      if (response.statusCode === 302) {
        downloadFile(response.headers.location, filepath)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Request Failed With a Status Code: ${response.statusCode} for URL: ${url}`));
        return;
      }

      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloadedSize = 0;

      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        const percentage = (downloadedSize / totalSize * 100).toFixed(2);
        process.stdout.write(`Downloading ${path.basename(filepath)}: ${percentage}%\r`);
      });

      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`\nDownloaded ${path.basename(filepath)}`);
        resolve(filepath);
      });
    });

    request.on('error', (err) => {
      fs.unlink(filepath, () => reject(err));
    });

    fileStream.on('error', (err) => {
      fs.unlink(filepath, () => reject(err));
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
    animationStyle = ''
  } = options;

  const apiUrl = `https://d53fdk5uti.execute-api.us-east-1.amazonaws.com/default/video_1_oct?text=${encodeURIComponent(text)}&transcription_format=segment&language=${language}`;
  
  console.log(`Requesting URL: ${apiUrl}`);  // Log the full URL being requested

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      console.log(`Attempt ${attempt + 1} of ${retries}`);
      const response = await axios.get(apiUrl);
      if (response.status === 200) {
        console.log('API response:', response.data);
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

function getRandomEffect(videoWidth, videoHeight, duration) {
  const effects = [
    `zoompan=z='min(zoom+0.0015,1.5)':d=${Math.round(duration*30)}:s=${videoWidth}x${videoHeight}`,
    `zoompan=z='if(lte(zoom,1.0),1.5,max(1.001,zoom-0.0015))':d=${Math.round(duration*30)}:s=${videoWidth}x${videoHeight}`,
    `zoompan=x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':z='zoom+0.002':d=${Math.round(duration*30)}:s=${videoWidth}x${videoHeight}`
  ];
  return effects[Math.floor(Math.random() * effects.length)];
}

// Add this function at an appropriate place in your code
function addImageAnimationsStyle4(videoLoop, videoWidth, videoHeight) {
  let filterComplex = '';
  const transitions = [
    'fade', 'fadeblack', 'fadewhite', 'distance', 'wipeleft', 'wiperight', 'wipeup', 'wipedown',
    'slideleft', 'slideright', 'slideup', 'slidedown', 'circlecrop', 'rectcrop', 'circleopen',
    'circleclose', 'vertopen', 'vertclose', 'horzopen', 'horzclose', 'dissolve'
  ];
  const transitionDuration = 1; // 1 second transition
  const fps = 25;

  videoLoop.forEach((video, i) => {
    const segmentDuration = video.segmentDuration || video.duration;
    const zoomEffect = getRandomEffect(videoWidth, videoHeight, segmentDuration);
    
    filterComplex += `[${i}:v]${zoomEffect},scale=${videoWidth}:${videoHeight}:force_original_aspect_ratio=increase,crop=${videoWidth}:${videoHeight},setsar=1,fps=${fps}[v${i}];`;
  });

  // Apply transitions without reducing clip duration
  if (videoLoop.length > 1) {
    let lastOutput = 'v0';
    for (let i = 1; i < videoLoop.length; i++) {
      const randomTransition = transitions[Math.floor(Math.random() * transitions.length)];
      const offset = videoLoop.slice(0, i).reduce((sum, v) => sum + (v.segmentDuration || v.duration), 0) - transitionDuration;
      filterComplex += `[${lastOutput}][v${i}]xfade=transition=${randomTransition}:duration=${transitionDuration}:offset=${offset}[xf${i}];`;
      lastOutput = `xf${i}`;
    }
    filterComplex += `[${lastOutput}]copy[outv];`;
  } else {
    filterComplex += `[v0]copy[outv];`;
  }

  return filterComplex;
}

// Modify the generateVideo function to include style_4
async function generateVideo(text, language = 'en', style = 'style_1', options = {}) {
  try {
    if (!text || text.trim() === '') {
      throw new Error('Empty text provided for video generation');
    }

    console.log('Fetching data from API...');
    let apiData = await fetchDataFromAPI(text, language, {
      videoAssets: options.videoAssets || 'all',
      animationStyle: style
    });

    // Check if apiData is valid
    if (!apiData || typeof apiData !== 'object') {
      throw new Error('Invalid API response');
    }

    console.log('API Data:', JSON.stringify(apiData, null, 2));

    // Extract data from API response
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
      colorText1,
      colorText2,
      colorBg,
      positionY,
      duration: apiDuration,
      words,
      fontFile,
      bg_music_file: backgroundMusicUrl, // Update this line to use bg_music_file
    } = apiData;

    // Check if apiVideos is undefined or not an array
    if (!apiVideos || !Array.isArray(apiVideos)) {
      console.error('API did not return a valid videos array. Using assets instead.');
      apiVideos = apiData.assets || [];
    }

    if (apiVideos.length === 0) {
      throw new Error('No video or image assets provided by API');
    }

    // Convert string values to appropriate types
    no_of_words = no_of_words === 'more' ? 4 : 2;
    font_size = parseInt(font_size);
    animation = animation === 'true' || animation === true;
    show_progression_bar = show_progression_bar === 'true';
    watermark = watermark === 'true';
    positionY = parseInt(positionY);
    const actualDuration = parseFloat(apiDuration);
    console.log('Actual duration from API:', actualDuration);
    if (isNaN(actualDuration) || actualDuration <= 0) {
      console.warn('Invalid actualDuration:', actualDuration);
      actualDuration = desiredDuration; // Fallback to desired duration
      console.log('Using fallback duration:', actualDuration);
    }

    const desiredDuration = 96; // Set the desired duration to 36 seconds
    console.log('API duration:', actualDuration);
    console.log('Desired duration:', desiredDuration);

    // Create video_details from apiVideos
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

    // Extract transcription details from video_details
    const transcription_details = video_details.map(video => ({
      start: video.segmentStart,
      end: video.segmentEnd,
      text: video.transcriptionPart,
      words: words ? words.filter(word => word.start >= video.segmentStart && word.end <= video.segmentEnd) : []
    }));

    console.log('Transcription details:', JSON.stringify(transcription_details, null, 2));

    console.log('Starting video generation process...');
    ffmpeg.setFfmpegPath('/usr/local/bin/ffmpeg/ffmpeg'); // Update this path if necessary

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

    const tempDir = path.join(__dirname, 'temp');
    await fsp.mkdir(tempDir, { recursive: true });
    console.log('Temporary directory created:', tempDir);

    // Create style-specific subfolder
    const styleFolder = path.join(__dirname, 'output', style);
    await fsp.mkdir(styleFolder, { recursive: true });
    console.log(`Style folder created: ${styleFolder}`);

    // Declare outputPath at the beginning of the function
    let outputPath;

    // Assign value to outputPath
    outputPath = path.join(styleFolder, `final_video_${language}_${style}.mp4`);

    const outputDir = path.dirname(outputPath);
    await fsp.mkdir(outputDir, { recursive: true });
    console.log('Output directory created:', outputDir);

    const videos = await Promise.all(video_details.map(async (asset, index) => {
      if (!asset.url) {
        console.warn(`Warning: Invalid URL for asset ${index}. Skipping.`);
        return null;
      }
      const assetPath = path.join(tempDir, `asset_${index}.${asset.assetType === 'image' ? 'jpg' : 'mp4'}`);
      await downloadFile(asset.url, assetPath);
      return { path: assetPath, duration: asset.duration, segmentDuration: asset.segmentDuration, assetType: asset.assetType };
    }));

    // Filter out null values (skipped videos)
    const validVideos = videos.filter(video => video !== null);

    if (validVideos.length === 0) {
      throw new Error('No valid videos available for processing after downloading');
    }

    console.log('Valid videos:', JSON.stringify(validVideos, null, 2));

    const videoLoop = validVideos;
    let totalVideoDuration = videoLoop.reduce((sum, video) => sum + video.segmentDuration, 0);

    console.log('Video loop created with total duration:', totalVideoDuration);

    // Handle font information
    let fontPath;
    let fontName;
    const fontsDir = '/root/VIDEOEDITOR/fonts/';
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
    await createASSSubtitleFile(transcription_details, subtitlePath, no_of_words, font_size, animation, videoWidth, videoHeight, actualDuration, colorText1, colorText2, colorBg, positionY, language, style, video_type, fontName, fontPath, show_progression_bar);

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
      await mixAudioWithBackgroundMusic(audioPath, bgMusicPath, mixedAudioPath, totalVideoDuration);
      console.log('Audio mixed with background music:', mixedAudioPath);
    } else {
      console.log('No background music URL provided by API');
    }

    // Use mixed audio if background music was provided, otherwise use original audio
    const extendedAudioPath = path.join(tempDir, 'extended_audio.mp3');
    await extendAudio(mixedAudioPath, extendedAudioPath, totalVideoDuration);

    console.log('Starting FFmpeg command...');
    await new Promise(async (resolve, reject) => {
      try {
        let command = ffmpeg();

        // Add inputs for all valid assets
        validVideos.forEach((video, index) => {
          command = command.input(video.path);
        });

        // Add audio input
        command = command.input(extendedAudioPath);

        let filterComplex = '';

        if (style === 'style_4') {
          // Use addImageAnimationsStyle4 for style_4
          filterComplex = addImageAnimationsStyle4(validVideos, videoWidth, videoHeight);
        } else {
          // Existing code for other styles
          validVideos.forEach((video, i) => {
            const segmentDuration = video.segmentDuration || video.duration;
            let inputPart = '';
            
            if (video.assetType === 'image') {
              inputPart = `[${i}:v]loop=loop=-1:size=1:start=0,setpts=PTS-STARTPTS,`;
              const effect = getRandomEffect(videoWidth, videoHeight, segmentDuration);
              inputPart += `${effect},`;
            } else {
              inputPart = `[${i}:v]trim=duration=${segmentDuration},setpts=PTS-STARTPTS,`;
            }
            
            filterComplex += `${inputPart}scale=${videoWidth}:${videoHeight}:force_original_aspect_ratio=increase,` +
                             `crop=${videoWidth}:${videoHeight},setsar=1,` +
                             `trim=duration=${segmentDuration}[v${i}];`;
          });

          // Concatenate all video parts for other styles
          const videoParts = validVideos.map((_, i) => `[v${i}]`).join('');
          filterComplex += `${videoParts}concat=n=${validVideos.length}:v=1:a=0[outv];`;
        }

        // Add subtitles for all styles
        filterComplex += `[outv]ass=${subtitlePath}[outv_sub];`;

        // Add progression bar filter only if show_progression_bar is true
        if (show_progression_bar) {
          filterComplex += 'color=c=' + colorText2 + ':s=' + videoWidth + 'x80[bar];';
          filterComplex += '[bar]split[bar1][bar2];';
          filterComplex += '[bar1]trim=duration=' + totalVideoDuration + '[bar1];';
          filterComplex += '[bar2]trim=duration=' + totalVideoDuration + ',geq='
            + 'r=\'if(lt(X,W*T/' + totalVideoDuration + '),' + parseInt(colorBg.slice(1, 3), 16) + ',' + parseInt(colorText2.slice(1, 3), 16) + ')\':'
            + 'g=\'if(lt(X,W*T/' + totalVideoDuration + '),' + parseInt(colorBg.slice(3, 5), 16) + ',' + parseInt(colorText2.slice(3, 5), 16) + ')\':'
            + 'b=\'if(lt(X,W*T/' + totalVideoDuration + '),' + parseInt(colorBg.slice(5, 7), 16) + ',' + parseInt(colorText2.slice(5, 7), 16) + ')\''
            + '[colorbar];';
          filterComplex += '[bar1][colorbar]overlay[progressbar];';
          filterComplex += '[outv_sub][progressbar]overlay=0:0[outv_final]';
        } else {
          filterComplex += '[outv_sub]copy[outv_final]';
        }

        console.log("Full filterComplex:", filterComplex);

        let outputOptions = [
          '-map', '[outv_final]',
          '-map', `${validVideos.length}:a`,
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-shortest',
          '-async', '1',
          '-vsync', '1',
          '-max_interleave_delta', '0',
          '-strict', '-2',
          '-scodec', 'copy'
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

        command
          .complexFilter(filterComplex)
          .outputOptions(outputOptions)
          .output(outputPath)
          .on('start', function(commandLine) {
            console.log('Spawned FFmpeg with command:', commandLine);
          })
          .on('progress', function(progress) {
            console.log('Processing: ' + progress.percent + '% done');
          })
          .on('stderr', function(stderrLine) {
            console.log('FFmpeg stderr:', stderrLine);
          })
          .on('error', function(err, stdout, stderr) {
            console.error('FFmpeg error:', err.message);
            console.error('FFmpeg stdout:', stdout);
            console.error('FFmpeg stderr:', stderr);
            reject(err);
          })
          .on('end', async () => {
            console.log('Video processing finished');
            // Clean up temporary files except subtitles
            for (const video of validVideos) {
              await fsp.unlink(video.path).catch(console.error);
            }
            await fsp.unlink(audioPath).catch(console.error);
            if (watermark) {
              await fsp.unlink(logoPath).catch(console.error);
            }
            resolve();
          })
          .run();
      } catch (error) {
        console.error('Error in video processing:', error);
        reject(error);
      }
    });

    // Store API requirements after successful video generation
    await storeAPIRequirements(language, style, apiData, outputPath, fontPath, totalVideoDuration);

    // After video generation is complete, upload to S3
    try {
      // Construct the correct video path with /root prefix
      const videoPath = path.join('/root/VIDEOEDITOR/output', style, `final_video_${language}_${style}.mp4`);
      console.log('Video file path for upload:', videoPath);
      
      if (!fs.existsSync(videoPath)) {
        throw new Error(`Video file not found at path: ${videoPath}`);
      }

      const s3 = new AWS.S3({
        accessKeyId: "AKIATTSKFTHDBRHTB2PX",
        secretAccessKey: "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"
      });

      const random_id = Math.floor(Math.random() * Date.now());
      const s3Key = `video_file/api/${style}/video-${language}-${style}-${random_id}.mp4`;

      console.log('Reading video file for S3 upload...');
      const fileContent = await fsp.readFile(videoPath);
      console.log('File size:', fileContent.length, 'bytes');
      
      console.log('Starting S3 upload with key:', s3Key);
      const uploadResult = await s3.upload({
        Bucket: "video-store-24",
        Key: s3Key,
        Body: fileContent,
        ContentType: 'video/mp4'
      }).promise();

      console.log('Video uploaded successfully to:', uploadResult.Location);

      // Clean up local files after successful upload
      await fsp.unlink(videoPath).catch(console.error);
      await fsp.unlink(subtitlePath).catch(console.error);
      console.log('Local files deleted');

      return uploadResult.Location;
    } catch (s3Error) {
      console.error('Error uploading to S3:', s3Error);
      const videoPath = path.join('/root/VIDEOEDITOR/output', style, `final_video_${language}_${style}.mp4`);
      console.log('Local video path:', videoPath);
      return videoPath;
    }

  } catch (error) {
    console.error(`Error in generateVideo for ${language}, ${style}:`, error.message);
    if (error.response && error.response.data) {
      console.error('API Error Details:', error.response.data);
    }
    throw error;
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
Style: Default,${fontName},${font_size},&H00${colorText1.slice(1)},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1

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

  for (let segment of transcription_details) {
    const startTime = formatASSTime(segment.start);
    const endTime = formatASSTime(segment.end);
    const words = segment.text.split(' ');

    for (let i = 0; i < words.length; i += no_of_words) {
      const slideWords = words.slice(i, i + no_of_words);
      const slideText = slideWords.join(' ');
      const slideDuration = (segment.end - segment.start) * (slideWords.length / words.length);
      const slideStartTime = formatASSTime(segment.start + (i / words.length) * (segment.end - segment.start));
      const slideEndTime = formatASSTime(Math.min(segment.start + ((i + slideWords.length) / words.length) * (segment.end - segment.start), segment.end));

      // Check if this is a segment that needs center alignment (at 1 second or 11 seconds)
      const needsCenterAlign = (segment.start === 1 || segment.start === 11);

      if (style === "style_2") {
        let lineContent = '';
        slideWords.forEach((word, index) => {
          const wordStart = segment.start + (i + index) * (segment.end - segment.start) / words.length;
          const wordEnd = wordStart + (segment.end - segment.start) / words.length;
          lineContent += `{\\k${Math.round((wordEnd - wordStart) * 100)}\\1c&HFFFFFF&\\3c&H000000&\\t(${formatASSTime(wordStart)},${formatASSTime(wordEnd)},\\1c&H00FFFF&)}${word} `;
        });

        assContent += `Dialogue: 0,${slideStartTime},${slideEndTime},Default,,0,0,0,,{\\an5\\pos(${centerX},${adjustedCenterY})}${lineContent.trim()}\n`;
      } else {
        // Style_1 and Style_3 rendering logic
        let totalWidth = slideWords.reduce((sum, word) => sum + getTextWidth(word, fontName, font_size), 0) 
                         + (slideWords.length - 1) * wordSpacing;
        let startX = needsCenterAlign ? centerX : (centerX - (totalWidth / 2));
        let currentX = startX;
        let currentY = adjustedCenterY;

        for (let j = 0; j < slideWords.length; j++) {
          const word = slideWords[j];
          const wordWidth = getTextWidth(word, fontName, font_size);

          if (currentX + wordWidth > centerX + (videoWidth - 20) / 2) {
            currentX = needsCenterAlign ? centerX - (totalWidth / 2) : startX;
            currentY += font_size;
          }

          assContent += `Dialogue: 1,${slideStartTime},${slideEndTime},Default,,0,0,0,,{\\an5\\pos(${currentX + wordWidth/2},${currentY})\\1c&H${colorText1.slice(1)}&}${word}\n`;

          if (animation) {
            const wordStart = formatASSTime(segment.start + (i + j) * slideDuration / slideWords.length);
            const wordEnd = formatASSTime(segment.start + (i + j + 1) * slideDuration / slideWords.length);
            assContent += `Dialogue: 0,${wordStart},${wordEnd},Default,,0,0,0,,{\\an5\\pos(${currentX + wordWidth/2},${currentY})\\bord0\\shad0\\c&H${colorBg.slice(1)}&\\alpha&H40&\\p1}m 0 0 l ${wordWidth} 0 ${wordWidth} ${font_size} 0 ${font_size}{\\p0}\n`;
          }

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
  const date = new Date(seconds * 1000);
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  const secs = date.getUTCSeconds().toString().padStart(2, '0');
  const ms = date.getUTCMilliseconds().toString().padStart(2, '0').slice(0, 2);
  return `${hours}:${minutes}:${secs}.${ms}`;
}

// Add this new function to generate transcription details from text
function generateTranscriptionDetails(text) {
  const words = text.split(' ');
  let currentTime = 0;
  const wordsPerSegment = 10;
  const segmentDuration = 5; // 5 seconds per segment

  return words.reduce((acc, word, index) => {
    if (index % wordsPerSegment === 0) {
      acc.push({
        id: acc.length,
        start: currentTime,
        end: currentTime + segmentDuration,
        text: words.slice(index, index + wordsPerSegment).join(' ')
      });
      currentTime += segmentDuration;
    }
    return acc;
  }, []);
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
  const styleFolder = path.join(__dirname, 'output', style);
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

  const languages = ['en','te', 'hi', 'ar', 'fr'];
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

main().then(() => process.exit(0)).catch(() => process.exit(1));

module.exports = { generateVideo };

function validateFilterComplex(filterComplex) {
  // Check for common syntax errors
  if (filterComplex.includes(',,') || filterComplex.includes(';;')) {
    throw new Error('Invalid filter complex: contains empty filters');
  }
  if (filterComplex.split('[').length !== filterComplex.split(']').length) {
    throw new Error('Invalid filter complex: mismatched brackets');
  }
  // Check for proper zoompan syntax
  const zoompanRegex = /zoompan=z='[^']*':d=\d+:s=\d+x\d+/g;
  const zoompanMatches = filterComplex.match(zoompanRegex);
  if (zoompanMatches) {
    zoompanMatches.forEach(match => {
      if (!match.includes(':s=')) {
        throw new Error('Invalid zoompan filter: missing size parameter');
      }
    });
  }
  // Check for empty filters
  const filterRegex = /\[[^\]]+\]([^,;\]]+,)*[^,;\]]+/g;
  const filters = filterComplex.match(filterRegex);
  if (filters) {
    filters.forEach(filter => {
      if (filter.endsWith(',')) {
        throw new Error('Invalid filter complex: filter ends with a comma');
      }
    });
  }
  console.log('Filter complex validation passed');
}

// Add this function at the end of your file:

function logFFmpegError(err, stdout, stderr) {
  console.error('FFmpeg error:', err.message);
  console.error('FFmpeg stdout:', stdout);
  console.error('FFmpeg stderr:', stderr);
  
  // Log more details about the error
  if (err.message.includes('Error reinitializing filters')) {
    console.error('Filter reinitialization error. Check your filterComplex string.');
  }
  if (stderr.includes('Invalid argument')) {
    console.error('Invalid argument error. Check your FFmpeg command options and filter arguments.');
  }
}

// New function to mix audio with background music
async function mixAudioWithBackgroundMusic(voiceoverPath, bgMusicPath, outputPath, duration) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(voiceoverPath)
      .input(bgMusicPath)
      .inputOptions(['-stream_loop -1']) // Loop background music
      .complexFilter([
        '[0:a]volume=1[voice]',
        '[1:a]volume=0.5[bg]', // Set background music volume to 50% of the voice
        '[voice][bg]amix=inputs=2:duration=longest[out]'
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
