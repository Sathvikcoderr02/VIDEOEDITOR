const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');

// AWS endpoint configuration
const AWS_ENDPOINT = 'http://44.192.60.59:3000';  
const axiosConfig = {
    timeout: 600000, 
    httpsAgent: new https.Agent({  
        rejectUnauthorized: false  
    })
};

// Sample texts for testing
const sampleTexts = [
    "The future of artificial intelligence is both exciting and challenging.",
    "Climate change remains one of our greatest global challenges.",
    "Space exploration continues to push the boundaries of human knowledge.",
    "Technology has transformed how we live, work, and communicate.",
    "Renewable energy is becoming increasingly important worldwide."
];

// Test parameters
const languages = ['en', 'hi'];  
const styles = ['style_1', 'style_2'];  
const videoTypes = ['landscape', 'portrait'];
const resolutions = ['720p'];  

// Helper function to get random array element
const getRandomItem = arr => arr[Math.floor(Math.random() * arr.length)];

// Generate random parameters for each request
function generateRandomParams() {
    return {
        text: getRandomItem(sampleTexts),
        language: getRandomItem(languages),
        style: getRandomItem(styles),
        videoType: getRandomItem(videoTypes),
        resolution: getRandomItem(resolutions),
        noOfWords: 4,
        fontSize: 100,
        animation: true,
        showProgressBar: true,
        watermark: true,
        colorText1: '#FFFFFF',
        colorText2: '#000000',
        colorBg: '#FF00FF',
        positionY: 50
    };
}

// Function to make a single request
async function makeRequest(id) {
    const params = generateRandomParams();
    const startTime = Date.now();
    
    console.log(`\nRequest ${id} starting with parameters:`, {
        text: params.text.substring(0, 30) + '...',
        language: params.language,
        style: params.style,
        videoType: params.videoType
    });
    
    try {
        const response = await axios.post(`${AWS_ENDPOINT}/generate-video`, params, axiosConfig);
        const duration = (Date.now() - startTime) / 1000;
        
        console.log(`Request ${id} completed successfully in ${duration.toFixed(2)}s. Response:`, response.data);
            
        return {
            id,
            status: 'success',
            duration,
            params,
            response: response.data,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        const errorDetails = {
            type: error.response ? 'API Error' : 'Network Error',
            message: error.message,
            statusCode: error.response?.status,
            serverError: error.response?.data?.error,
            stack: error.stack
        };
        console.error(`Request ${id} failed after ${((Date.now() - startTime)/1000).toFixed(2)}s:`, errorDetails);
        return {
            id,
            status: 'error',
            error: errorDetails,
            params,
            duration: (Date.now() - startTime) / 1000,
            timestamp: new Date().toISOString()
        };
    }
}

// Main stress test function
async function runStressTest(totalRequests = 25, concurrentRequests = 3) {
    console.log(`Starting AWS video generation stress test with ${totalRequests} total requests (${concurrentRequests} concurrent)`);
    const startTime = Date.now();
    const results = [];
    
    // Create output directory for results
    const resultsDir = path.join(__dirname, 'aws_stress_test_results');
    await fs.mkdir(resultsDir, { recursive: true });
    
    // Process requests in batches
    for (let i = 0; i < totalRequests; i += concurrentRequests) {
        const batch = Math.min(concurrentRequests, totalRequests - i);
        console.log(`\nProcessing batch ${Math.floor(i/concurrentRequests) + 1}/${Math.ceil(totalRequests/concurrentRequests)}`);
        
        const promises = Array(batch).fill().map((_, index) => 
            makeRequest(i + index + 1)
        );

        const batchResults = await Promise.all(promises);
        results.push(...batchResults);

        // Wait longer between batches for AWS
        if (i + concurrentRequests < totalRequests) {
            console.log('Waiting 30 seconds before next batch...');
            await new Promise(resolve => setTimeout(resolve, 30000));
        }
    }

    // Calculate and display results
    const endTime = Date.now();
    const totalTime = (endTime - startTime) / 1000;
    const successful = results.filter(r => r.status === 'success');
    const failed = results.filter(r => r.status === 'error');
    
    // Group errors by type
    const errorAnalysis = failed.reduce((acc, f) => {
        const errorType = f.error.type;
        if (!acc[errorType]) {
            acc[errorType] = {
                count: 0,
                examples: []
            };
        }
        acc[errorType].count++;
        acc[errorType].examples.push({
            requestId: f.id,
            error: f.error,
            params: f.params
        });
        return acc;
    }, {});
    
    console.log('\n=== AWS Video Generation Stress Test Results ===');
    console.log(`Total Requests: ${totalRequests}`);
    console.log(`Successful: ${successful.length}`);
    console.log(`Failed: ${failed.length}`);
    console.log(`Total Time: ${totalTime.toFixed(2)} seconds`);
    console.log(`Average Time per Request: ${(totalTime/totalRequests).toFixed(2)} seconds`);

    if (successful.length > 0) {
        const avgDuration = successful.reduce((sum, r) => sum + r.duration, 0) / successful.length;
        console.log(`Average Processing Time (successful requests): ${avgDuration.toFixed(2)} seconds`);
    }

    // Save detailed results
    const resultLog = {
        timestamp: new Date().toISOString(),
        totalRequests,
        successful: successful.length,
        failed: failed.length,
        totalTime,
        averageTime: totalTime/totalRequests,
        errorAnalysis,
        successfulRequests: successful,
        failedRequests: failed.map(f => ({
            ...f,
            errorSummary: {
                type: f.error.type,
                message: f.error.message,
                statusCode: f.error.statusCode,
                serverError: f.error.serverError
            }
        }))
    };

    const resultFile = path.join(resultsDir, `aws_stress_test_results_${Date.now()}.json`);
    await fs.writeFile(resultFile, JSON.stringify(resultLog, null, 2));
    console.log(`\nDetailed results saved to ${resultFile}`);
    
    // Print error analysis
    if (failed.length > 0) {
        console.log('\n=== Error Analysis ===');
        Object.entries(errorAnalysis).forEach(([type, data]) => {
            console.log(`\n${type}: ${data.count} occurrences`);
            console.log('Example error:', data.examples[0].error.message);
        });
    }
}

// Run the stress test with 25 total requests, 3 concurrent
runStressTest(25, 3).catch(console.error);
