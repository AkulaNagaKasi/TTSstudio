const express = require('express');
const multer = require('multer');
const gtts = require('gtts');
const path = require('path');
const fs = require('fs');
const app = express();

// Set up multer storage configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads');
    fs.promises.mkdir(uploadDir, { recursive: true }).then(() => {
      cb(null, uploadDir);
    }).catch(err => cb(err));
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

// Configure multer with file filter
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Accept only .txt files
    if (path.extname(file.originalname).toLowerCase() === '.txt') {
      cb(null, true);
    } else {
      cb(new Error('Only .txt files are allowed'));
    }
  }
});

// Create audio directory if it doesn't exist
const audioDir = path.join(__dirname, 'public', 'audio');
fs.promises.mkdir(audioDir, { recursive: true }).catch(console.error);

// Setup middleware
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));

// Serve homepage
app.get('/', (req, res) => {
  res.render('index');
});

// Handle combined form submission
app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    let textToConvert = '';

    if (req.file) {
      textToConvert = await fs.promises.readFile(req.file.path, 'utf-8');
      await fs.promises.unlink(req.file.path);
    } else if (req.body.textInput) {
      textToConvert = req.body.textInput;
    } else {
      return res.status(400).send('<script>alert("No text or file provided"); window.history.back();</script>');
    }

    // Get selected voice and gender from request
    const selectedVoice = req.body.voice || 'en'; // Default to 'en' if not provided
    const gender = req.body.gender || 'male'; // Default to 'male'

    // Map gender to voice variation
    let voiceCode = selectedVoice;
    if (gender === 'male') {
      // Male voices (or male-sounding accents)
      const maleVoices = {
        'en': 'en-us', // English (US) Male voice
        'en-uk': 'en-uk', // UK English Male voice
        'en-au': 'en-au', // Australian English Male voice
        'hi': 'hi', // Hindi Male voice
        'fr': 'fr', // French Male voice
        'es': 'es' // Spanish Male voice
      };
      voiceCode = maleVoices[selectedVoice] || selectedVoice;
    } else if (gender === 'female') {
      // Female voices (or female-sounding accents)
      const femaleVoices = {
        'en': 'en', // English (US) Female voice
        'en-uk': 'en-uk', // UK English Female voice
        'en-au': 'en-au', // Australian English Female voice
        'hi': 'hi', // Hindi Female voice
        'fr': 'fr', // French Female voice
        'es': 'es' // Spanish Female voice
      };
      voiceCode = femaleVoices[selectedVoice] || selectedVoice;
    }

    const outputFileName = `speech-${Date.now()}.mp3`;
    const outputPath = path.join(audioDir, outputFileName);

    // Create GTTS instance with the selected voice
    const gttsInstance = new gtts(textToConvert, voiceCode);

    await new Promise((resolve, reject) => {
      gttsInstance.save(outputPath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Send file for preview and download
    res.sendFile(outputPath, async (err) => {
      if (err) {
        console.error('Error sending file:', err);
        return res.status(500).send('<script>alert("Error sending audio file"); window.history.back();</script>');
      }

      // Clean up after sending
      try {
        await fs.promises.unlink(outputPath);
      } catch (error) {
        console.error('Error cleaning up file:', error);
      }
    });

  } catch (error) {
    console.error('Conversion error:', error);
    res.status(500).send('<script>alert("Error processing your request"); window.history.back();</script>');
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ 
    error: error.message || 'Internal server error' 
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
