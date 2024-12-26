const express = require('express');
const { generateVideo } = require('./test.js');
const app = express();
const port = 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Video generation endpoint
app.post('/generate-video', async (req, res) => {
    try {
        const {
            text,
            language = 'en',
            style = 'style_1',
            transcription_format = 'segment',
            animation = 'true'
        } = req.body;

        // Validate required parameters
        if (!text) {
            return res.status(400).json({
                status: 'error',
                message: 'Text parameter is required'
            });
        }

        // Generate video and get URL
        console.log('Generating video with parameters:', {
            text: text.substring(0, 50) + '...',
            language,
            style,
            transcription_format,
            animation
        });

        const videoUrl = await generateVideo(text, language, style, {
            transcription_format,
            animation: animation === 'true'
        });

        res.json({
            status: 'success',
            videoUrl,
            message: 'Video generated successfully'
        });

    } catch (error) {
        console.error('Error generating video:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Error generating video'
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

// Start server
const HOST = '0.0.0.0';
app.listen(port, HOST, () => {
    console.log(`Video generation server running at http://${HOST}:${port}`);
    console.log('Server is ready to accept video generation requests');
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
});
