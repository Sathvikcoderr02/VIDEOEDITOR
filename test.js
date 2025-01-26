const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const https = require('https');
const http = require('http');
const axios = require('axios');

// Define the video_type variable
//const video_type = "portrait"; // Change this value to "landscape", "square", or "portrait"

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

async function fetchDataFromAPI(text, retries = 2, initialDelay = 5000) {
  if (!text || text.trim() === '') {
    console.error('Error: Empty text provided to API');
    throw new Error('Empty text provided to API');
  }

  const apiUrl = `https://d53fdk5uti.execute-api.us-east-1.amazonaws.com/default/video_1_oct?text=${text}&transcription_format=segment`;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      console.log(`Attempt ${attempt + 1} of ${retries}`);
      console.log(`Requesting URL: ${apiUrl}`);  // Log the full URL being requested
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

async function generateVideo(text) {
  try {
    if (!text || text.trim() === '') {
      throw new Error('Empty text provided for video generation');
    }

    console.log('Fetching data from API...');
    let apiData = await fetchDataFromAPI(text);

    // Check if apiData is valid
    if (!apiData || typeof apiData !== 'object') {
      throw new Error('Invalid API response');
    }

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
      words // Extract words from the API response
    } = apiData;

    // Convert string values to appropriate types
    no_of_words = no_of_words === 'more' ? 4 : 2;
    font_size = parseInt(font_size);
    animation = animation === 'true';
    show_progression_bar = show_progression_bar === 'true';
    watermark = watermark === 'true';
    positionY = parseInt(positionY);
    const actualDuration = parseFloat(apiDuration);
    console.log('Actual duration from API:', actualDuration);

    const desiredDuration = 36; // Set the desired duration to 36 seconds
    console.log('API duration:', actualDuration);
    console.log('Desired duration:', desiredDuration);

    // Map the apiVideos array to include duration
    const video_details = apiVideos.map(video => ({ 
      url: video.videoUrl, 
      duration: video.videoDuration,
      segmentDuration: video.segmentDuration
    }));

    // Ensure apiVideos array is valid
    if (!Array.isArray(apiVideos) || apiVideos.length === 0) {
      throw new Error('Invalid video details provided by API');
    }

    // Extract transcription details from apiVideos
    const transcription_details = apiVideos.map(video => ({
      start: video.segmentStart,
      end: video.segmentEnd,
      text: video.transcriptionPart,
      words: words ? words.filter(word => word.start >= video.segmentStart && word.end <= video.segmentEnd) : []
    }));

    console.log('Transcription details:', transcription_details);

    console.log('Starting video generation process...');
    ffmpeg.setFfmpegPath('/usr/local/bin/ffmpeg'); // Update this path if necessary

    // Set video dimensions based on resolution
    let videoWidth, videoHeight;
    switch (resolution) {
      case "720p":
        videoWidth = video_type === "landscape" ? 1280 : 720;
        videoHeight = video_type === "landscape" ? 720 : 1280;
        break;
      case "1080p":
      default:
        videoWidth = video_type === "landscape" ? 1920 : 1080;
        videoHeight = video_type === "landscape" ? 1080 : 1920;
        break;
    }

    const tempDir = path.join(__dirname, 'temp');
    await fsp.mkdir(tempDir, { recursive: true });
    console.log('Temporary directory created:', tempDir);

    const outputPath = path.join(__dirname, 'output', 'final_video.mp4');
    const outputDir = path.dirname(outputPath);
    await fsp.mkdir(outputDir, { recursive: true });
    console.log('Output directory created:', outputDir);

    const videos = await Promise.all(video_details.map(async (video, index) => {
      if (!video.url) {
        console.warn(`Warning: Invalid URL for video ${index}. Skipping.`);
        return null;
      }
      const videoPath = path.join(tempDir, `video_${index}.mp4`);
      await downloadFile(video.url, videoPath);
      return { path: videoPath, duration: video.duration, segmentDuration: video.segmentDuration };
    }));

    // Filter out null values (skipped videos)
    const validVideos = videos.filter(video => video !== null);

    if (validVideos.length === 0) {
      throw new Error('No valid videos available for processing after downloading');
    }

    const videoLoop = [];
    let totalVideoDuration = 0;

    while (totalVideoDuration < desiredDuration) {
      for (const video of validVideos) {
        const remainingDuration = desiredDuration - totalVideoDuration;
        const segmentDuration = Math.min(parseFloat(video.segmentDuration), remainingDuration);
        videoLoop.push({...video, segmentDuration});
        totalVideoDuration += segmentDuration;
        if (totalVideoDuration >= desiredDuration) break;
      }
    }

    console.log('Video loop created with total duration:', totalVideoDuration);

    const subtitlePath = path.join(tempDir, 'subtitles.ass');
    await createASSSubtitleFile(transcription_details, subtitlePath, no_of_words, font_size, animation, videoWidth, videoHeight, actualDuration, colorText1, colorText2, colorBg, positionY);

    const fontPath = '/Users/sathvik02/Documents/c/fonts/PoetsenOne-Regular.ttf';
    
    if (!fs.existsSync(fontPath)) {
      throw new Error(`Font file not found: ${fontPath}`);
    }

    const subtitleContent = await fsp.readFile(subtitlePath, 'utf8');
    console.log('Subtitle file content:', subtitleContent);

    // Use logo_url instead of hardcoded logo URL
    const logoPath = path.join(tempDir, 'logo.png');
    await downloadFile(logo_url, logoPath);

    // Adjust audio duration
    const audioPath = path.join(tempDir, 'audio.mp3');
    await downloadFile(audio_link, audioPath);
    const extendedAudioPath = path.join(tempDir, 'extended_audio.mp3');
    await extendAudio(audioPath, extendedAudioPath, desiredDuration);

    console.log('Starting FFmpeg command...');
    return new Promise((resolve, reject) => {
      let command = ffmpeg();

      videoLoop.forEach((video) => {
        command = command.input(video.path);
      });

      command = command.input(extendedAudioPath);

      let filterComplex = videoLoop.map((video, i) => 
        `[${i}:v]trim=duration=${video.segmentDuration.toFixed(3)},setpts=PTS-STARTPTS,scale=${videoWidth}:${videoHeight}:force_original_aspect_ratio=increase,crop=${videoWidth}:${videoHeight},setsar=1[v${i}];`
      ).join('');
      
      filterComplex += videoLoop.map((_, i) => `[v${i}]`).join('');
      filterComplex += `concat=n=${videoLoop.length}:v=1:a=0[outv];`;
      filterComplex += `[outv]ass=${subtitlePath}[outv];`;

      // Add watermark only if watermark is true
      if (watermark) {
        filterComplex += `[${videoLoop.length + 1}:v]format=rgba,colorchannelmixer=aa=0.2[logo];`;
        filterComplex += `[outv][logo]overlay=W-w-10:H-h-10[outv];`;
      }

      // Add progression bar filter only if show_progression_bar is true
      if (show_progression_bar) {
        filterComplex += `color=c=${colorText2}:s=${videoWidth}x80[bar];`;
        filterComplex += `[bar]split[bar1][bar2];`;
        filterComplex += `[bar1]trim=duration=${desiredDuration}[bar1];`;
        filterComplex += `[bar2]trim=duration=${desiredDuration},geq=`
          + `r='if(lt(X,W*T/${desiredDuration}),${parseInt(colorBg.slice(1, 3), 16)},${parseInt(colorText2.slice(1, 3), 16)})':`
          + `g='if(lt(X,W*T/${desiredDuration}),${parseInt(colorBg.slice(3, 5), 16)},${parseInt(colorText2.slice(3, 5), 16)})':`
          + `b='if(lt(X,W*T/${desiredDuration}),${parseInt(colorBg.slice(5, 7), 16)},${parseInt(colorText2.slice(5, 7), 16)})'`
          + `[colorbar];`;
        filterComplex += `[bar1][colorbar]overlay[progressbar];`;
        filterComplex += `[outv][progressbar]overlay=0:0[outv_final]`;
      } else {
        filterComplex += `[outv]copy[outv_final]`;
      }

      let outputOptions = [
        '-map', '[outv_final]',
        '-map', `${videoLoop.length}:a`,
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-shortest',
        '-t', `${desiredDuration.toFixed(3)}`
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

      if (watermark) {
        command = command.input(logoPath);
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
        .on('error', function(err, stdout, stderr) {
          console.error('FFmpeg error:', err.message);
          console.error('FFmpeg stdout:', stdout);
          console.error('FFmpeg stderr:', stderr);
          reject(err);
        })
        .on('end', async () => {
          console.log('Video processing finished');
          for (const video of validVideos) {
            await fsp.unlink(video.path).catch(console.error);
          }
          await fsp.unlink(audioPath).catch(console.error);
          await fsp.unlink(subtitlePath).catch(console.error);
          if (watermark) {
            await fsp.unlink(logoPath).catch(console.error);
          }
          resolve(outputPath);
        })
        .run();
    });
  } catch (error) {
    console.error('Error in generateVideo:', error.message);
    if (error.response && error.response.data) {
      console.error('API Error Details:', error.response.data);
    }
    throw error;
  }
}

async function createASSSubtitleFile(transcription_details, outputPath, no_of_words, font_size, animation, videoWidth, videoHeight, actualDuration, colorText1, colorText2, colorBg, positionY) {
  const assHeader = `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
Aspect Ratio: ${videoWidth}:${videoHeight}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,PoetsenOne,${font_size},&H00${colorText1.slice(1)},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,2,10,10,200,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  let assContent = assHeader;
  const centerY = (videoHeight * positionY) / 100;
  const centerX = videoWidth / 2;
  const wordSpacing = 0.1;
  const maxWidth = videoWidth - 20;

  let allWords = transcription_details.flatMap(segment => 
    (segment.words && segment.words.length > 0) ? segment.words : 
    segment.text.split(' ').map((word, index, array) => ({
      word,
      start: segment.start + (index / array.length) * (segment.end - segment.start),
      end: segment.start + ((index + 1) / array.length) * (segment.end - segment.start)
    }))
  );

  let totalDuration = transcription_details[transcription_details.length - 1].end - transcription_details[0].start;

  for (let i = 0; i < allWords.length;) {
    let slideWords = [];
    let currentLineWidth = 0;
    let lineCount = 0;

    while (slideWords.length < no_of_words && i < allWords.length) {
      let nextWord = allWords[i];
      let wordWidth = getTextWidth(nextWord.word, 'Poetsen One', font_size);

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

    let slideStart = slideWords[0].start;
    let slideEnd = slideWords[slideWords.length - 1].end;

    let totalWidth = slideWords.reduce((sum, word) => sum + getTextWidth(word.word, 'Poetsen One', font_size), 0) 
                     + (slideWords.length - 1) * wordSpacing;
    let startX = centerX - (totalWidth / 2);

    let currentX = startX;
    let currentY = centerY - (lineCount * font_size / 2);

    // Render static words
    for (let j = 0; j < slideWords.length; j++) {
      let word = slideWords[j];
      let wordWidth = getTextWidth(word.word, 'Poetsen One', font_size);

      if (currentX + wordWidth > centerX + maxWidth / 2) {
        currentX = startX;
        currentY += font_size;
      }

      assContent += `Dialogue: 1,${formatASSTime(slideStart)},${formatASSTime(slideEnd)},Default,,0,0,0,,{\\an5\\pos(${currentX + wordWidth/2},${currentY})\\1c&H${colorText1.slice(1)}&}${word.word}\n`;

      currentX += wordWidth + wordSpacing;
    }

    // Render moving highlights
    if (animation) {
      currentX = startX;
      currentY = centerY - (lineCount * font_size / 2);

      for (let j = 0; j < slideWords.length; j++) {
        let word = slideWords[j];
        let wordWidth = getTextWidth(word.word, 'Poetsen One', font_size);

        if (currentX + wordWidth > centerX + maxWidth / 2) {
          currentX = startX;
          currentY += font_size;
        }

        assContent += `Dialogue: 0,${formatASSTime(word.start)},${formatASSTime(word.end)},Default,,0,0,0,,{\\an5\\pos(${currentX + wordWidth/2},${currentY})\\bord0\\shad0\\c&H${colorBg.slice(1)}&\\alpha&H40&\\p1}m 0 0 l ${wordWidth} 0 ${wordWidth} ${font_size} 0 ${font_size}{\\p0}\n`;

        currentX += wordWidth + wordSpacing;
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
async function extendAudio(inputPath, outputPath, desiredDuration) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFilters(`apad=pad_dur=${desiredDuration}`)
      .duration(desiredDuration)
      .on('error', reject)
      .on('end', resolve)
      .save(outputPath);
  });
}

// Update the main execution
async function main() {
  const sampleText = "Peace is a state of tranquility, calmness, and harmony, both within oneself and in the external environment. It is the absence of war, conflict, and violence, and the presence of serenity, stability, and balance. In a broader sense, peace can also refer to a sense of inner peace, which is characterized by a state of mind that is free from anxiety, worry, and turmoil. It is often associated with qualities such as kindness, compassion, and understanding.";

  try {
    const outputPath = await generateVideo(sampleText);
    console.log(`Video created successfully: ${outputPath}`);
  } catch (err) {
    console.error('Error creating video:', err.message);
    // Here you could implement fallback logic or retry mechanisms
  }
}

main().then(() => process.exit(0)).catch(() => process.exit(1));

module.exports = { generateVideo };
