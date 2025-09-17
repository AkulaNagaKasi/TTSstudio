const express = require('express');
const multer = require('multer');
const gtts = require('gtts');
const path = require('path');
const fs = require('fs');
const app = express();
let edgeTTS;

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
app.use(express.static(path.join(__dirname, 'public')));
// Serve uploads so STT downloads and uploaded audio links work
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));

// Basic request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Serve homepage
app.get('/', (req, res) => {
  res.render('index');
});

// STT: save transcript as a downloadable txt file
app.post('/stt/save', express.json(), async (req, res) => {
  try {
    const text = (req.body && req.body.text ? String(req.body.text) : '').trim();
    if (!text) {
      return res.status(400).json({ error: 'No text provided' });
    }
    const fileName = `transcript-${Date.now()}.txt`;
    const outputPath = path.join(__dirname, 'uploads', fileName);
    await fs.promises.mkdir(path.join(__dirname, 'uploads'), { recursive: true });
    await fs.promises.writeFile(outputPath, text, 'utf-8');
    const publicUrl = `/uploads/${fileName}`;
    return res.json({ success: true, url: publicUrl, fileName });
  } catch (err) {
    console.error('STT save error:', err);
    res.status(500).json({ error: 'Failed to save transcript' });
  }
});

// STT: accept audio file upload (mp3/wav/m4a) and return a public URL
const audioUpload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp3', '.wav', '.m4a', '.ogg', '.webm'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only audio files are allowed'));
  }
});

app.post('/stt/upload', audioUpload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file uploaded' });
    const fileName = req.file.filename;
    const publicUrl = `/uploads/${fileName}`;
    return res.json({ success: true, url: publicUrl, fileName });
  } catch (err) {
    console.error('STT upload error:', err);
    res.status(500).json({ error: 'Failed to upload audio' });
  }
});

// List voices endpoint
app.get('/voices', async (req, res) => {
  const engine = (req.query.engine || 'edge').toLowerCase();
  try {
    if (engine === 'edge') {
      if (!edgeTTS) edgeTTS = require('edge-tts');
      const result = await edgeTTS.listVoices();
      return res.json({ engine: 'edge', voices: result });
    }
    return res.json({ engine, voices: [] });
  } catch (err) {
    console.error('Voices error:', err);
    res.status(500).json({ error: 'Failed to list voices' });
  }
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

    // Engine and voice
    const engine = (req.body.engine || 'gtts').toLowerCase();
    const selectedVoice = req.body.voice || 'en';
    const gender = req.body.gender || 'male';

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

    console.log('Starting conversion:', {
      textLength: textToConvert.length,
      selectedVoice,
      gender,
      voiceCode,
      outputPath
    });

    if (engine === 'edge') {
      if (!edgeTTS) edgeTTS = require('edge-tts');
      const voice = req.body.voice || 'en-US-AriaNeural';
      console.log('Using Edge TTS with voice', voice);
      const stream = await edgeTTS.synthesize({ input: textToConvert, voice });
      await fs.promises.writeFile(outputPath, Buffer.from(stream.audio));
      console.log('Edge TTS saved file successfully at', outputPath);
    } else {
      // GTTS path
      const gttsInstance = new gtts(textToConvert, voiceCode);
      await new Promise((resolve, reject) => {
        gttsInstance.save(outputPath, (err) => {
          if (err) {
            console.error('GTTS save error:', err);
            reject(err);
          } else {
            console.log('GTTS saved file successfully at', outputPath);
            resolve();
          }
        });
      });
    }

    // Instead of streaming and deleting immediately, keep file and return URL
    const publicUrl = `/audio/${outputFileName}`;
    console.log('Returning audio URL:', publicUrl);
    return res.status(200).json({
      success: true,
      url: publicUrl,
      fileName: outputFileName
    });

  } catch (error) {
    console.error('Conversion error:', error);
    res.status(500).send('<script>alert("Error processing your request"); window.history.back();</script>');
  }
});

app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ 
    error: error.message || 'Internal server error' 
  });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

server.on('error', (err) => {
  console.error('Failed to start server:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
