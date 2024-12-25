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

        // Validate language
        const validLanguages = ['en', 'hi', 'ar', 'fr'];
        if (!validLanguages.includes(language)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid language. Supported languages: en, hi, ar, fr'
            });
        }

        // Validate style
        const validStyles = ['style_1', 'style_2', 'style_3', 'style_4'];
        if (!validStyles.includes(style)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid style. Supported styles: style_1, style_2, style_3, style_4'
            });
        }

        console.log('Starting video generation with parameters:', {
            text,
            language,
            style,
            transcription_format,
            animation
        });

        // Generate video
        const videoPath = await generateVideo(text, language, style, {
            transcription_format,
            animation: animation === 'true'
        });

        res.json({
            status: 'success',
            videoPath,
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
app.listen(port, '0.0.0.0', () => {
    console.log(`Video generation server running on port ${port}`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
}); 