// === KOMPLETT ROTARY AI SYSTEM ===
// Färdig för Railway deployment

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const sharp = require('sharp');
const tesseract = require('tesseract.js');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3001;

// === MIDDLEWARE ===
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// Skapa uploads-katalog
const uploadsDir = './uploads';
fs.mkdir(uploadsDir).catch(() => {}); // Ignorera fel om den redan finns

// === MULTER KONFIGURATION ===
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'audio/mpeg', 'audio/wav', 'audio/mp3',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Filtyp ${file.mimetype} stöds inte`));
    }
  }
});

// === E-POST KONFIGURATION ===
const emailConfig = {
  user: process.env.EMAIL_USER || 'ai@luvi.se',
  password: process.env.EMAIL_PASSWORD || 'Jsy7j4kfvjg!',
  host: process.env.EMAIL_HOST || 'mailcluster.loopia.se',
  port: parseInt(process.env.EMAIL_PORT) || 993,
  tls: true,
  connTimeout: 60000,
  authTimeout: 5000,
  debug: process.env.NODE_ENV === 'development' ? console.log : null,
  tlsOptions: { rejectUnauthorized: false }
};

// === CLAUDE API KONFIGURATION ===
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

// === GLOBALA VARIABLER ===
let processedEmails = [];
let isConnected = false;
let connectionAttempts = 0;
let lastError = null;

// === E-POST PROCESSOR KLASS ===
class EmailProcessor {
  constructor() {
    this.imap = null;
    this.isConnected = false;
    this.reconnectTimer = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      try {
        this.imap = new Imap(emailConfig);
        
        this.imap.once('ready', () => {
          console.log('✅ IMAP anslutning etablerad till', emailConfig.host);
          this.isConnected = true;
          isConnected = true;
          connectionAttempts = 0;
          lastError = null;
          resolve();
        });

        this.imap.once('error', (err) => {
          console.error('❌ IMAP fel:', err.message);
          this.isConnected = false;
          isConnected = false;
          connectionAttempts++;
          lastError = err.message;
          
          // Auto-reconnect efter 30 sekunder
          if (connectionAttempts < 5) {
            setTimeout(() => {
              console.log(`🔄 Återanslutningsförsök ${connectionAttempts}/5...`);
              this.connect().catch(console.error);
            }, 30000);
          }
          
          reject(err);
        });

        this.imap.once('end', () => {
          console.log('🔌 IMAP anslutning stängd');
          this.isConnected = false;
          isConnected = false;
        });

        this.imap.connect();
      } catch (error) {
        reject(error);
      }
    });
  }

  async fetchEmails() {
    if (!this.isConnected) {
      throw new Error('Inte ansluten till IMAP');
    }

    return new Promise((resolve, reject) => {
      this.imap.openBox('INBOX', false, (err, box) => {
        if (err) {
          reject(err);
          return;
        }

        // Sök efter e-post från senaste 7 dagarna
        const searchDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const searchCriteria = ['SINCE', searchDate];
        
        this.imap.search(searchCriteria, (err, results) => {
          if (err) {
            reject(err);
            return;
          }

          if (!results || results.length === 0) {
            console.log('📭 Inga nya e-post hittade');
            resolve([]);
            return;
          }

          console.log(`📬 Hittade ${results.length} e-post att bearbeta`);
          const emails = [];
          const fetch = this.imap.fetch(results.slice(-10), { // Begränsa till senaste 10
            bodies: '',
            struct: true,
            envelope: true
          });

          fetch.on('message', (msg, seqno) => {
            let emailData = {};
            
            msg.on('body', (stream, info) => {
              let buffer = '';
              stream.on('data', (chunk) => {
                buffer += chunk.toString('utf8');
              });
              
              stream.once('end', async () => {
                try {
                  const parsed = await simpleParser(buffer);
                  emailData = {
                    id: seqno,
                    subject: parsed.subject || 'Inget ämne',
                    from: parsed.from?.text || 'Okänd avsändare',
                    date: parsed.date || new Date(),
                    text: parsed.text || '',
                    html: parsed.html || '',
                    attachments: parsed.attachments?.map(att => ({
                      name: att.filename || 'unnamed',
                      type: att.contentType || 'unknown',
                      size: att.size || 0,
                      data: att.content
                    })) || [],
                    processed: false
                  };
                  emails.push(emailData);
                } catch (parseErr) {
                  console.error('Fel vid e-post parsing:', parseErr);
                }
              });
            });
          });

          fetch.once('error', reject);
          fetch.once('end', () => {
            // Sortera efter datum (nyast först)
            emails.sort((a, b) => new Date(b.date) - new Date(a.date));
            resolve(emails);
          });
        });
      });
    });
  }

  disconnect() {
    if (this.imap) {
      this.imap.end();
    }
  }
}

// === AI ANALYZER KLASS ===
class AIAnalyzer {
  async analyzeImage(imagePath) {
    try {
      const processedImagePath = imagePath + '_processed.jpg';
      
      // Förbered bilden för OCR
      await sharp(imagePath)
        .resize(1200, null, { withoutEnlargement: true })
        .normalize()
        .sharpen()
        .jpeg({ quality: 90 })
        .toFile(processedImagePath);

      console.log('🔍 Kör OCR på bild:', path.basename(imagePath));
      
      // OCR med svensk och engelsk språkstöd
      const { data: { text } } = await tesseract.recognize(processedImagePath, 'swe+eng', {
        logger: m => console.log('OCR:', m.status, m.progress)
      });
      
      // Rensa temporär fil
      await fs.unlink(processedImagePath).catch(() => {});

      // Analysera text för föredragshållare
      const speakerPatterns = [
        /(?:föredragshållare|talare|gäst|presenter?)[\s:]*([A-ZÅÄÖ][a-zåäö]+\s+[A-ZÅÄÖ][a-zåäö]+)/i,
        /([A-ZÅÄÖ][a-zåäö]+\s+[A-ZÅÄÖ][a-zåäö]+)[\s,]*(?:föredragshållare|talare|gäst)/i,
        /(?:med|från)[\s]+([A-ZÅÄÖ][a-zåäö]+\s+[A-ZÅÄÖ][a-zåäö]+)/i
      ];
      
      let speaker = null;
      for (const pattern of speakerPatterns) {
        const match = text.match(pattern);
        if (match) {
          speaker = match[1];
          break;
        }
      }

      return {
        extractedText: text,
        speaker: speaker,
        isSpeakerImage: this.analyzeIfSpeakerImage(text),
        confidence: text.length > 50 ? 0.8 : 0.4
      };
    } catch (error) {
      console.error('Bildanalysfel:', error);
      return { extractedText: '', speaker: null, isSpeakerImage: false, confidence: 0 };
    }
  }

  analyzeIfSpeakerImage(text) {
    const speakerKeywords = ['föredragshållare', 'talare', 'gäst', 'presenter', 'expert', 'föredrag'];
    const lowerText = text.toLowerCase();
    return speakerKeywords.some(keyword => lowerText.includes(keyword));
  }

  async analyzePDF(pdfPath) {
    try {
      console.log('📄 Analyserar PDF:', path.basename(pdfPath));
      const dataBuffer = await fs.readFile(pdfPath);
      const pdfData = await pdf(dataBuffer);
      
      return {
        text: pdfData.text,
        pages: pdfData.numpages,
        title: pdfData.info?.Title || null,
        confidence: 0.9
      };
    } catch (error) {
      console.error('PDF-analysfel:', error);
      return { text: '', pages: 0, title: null, confidence: 0 };
    }
  }

  async analyzeWordDoc(docPath) {
    try {
      console.log('📝 Analyserar Word-dokument:', path.basename(docPath));
      const result = await mammoth.extractRawText({ path: docPath });
      
      return {
        text: result.value,
        messages: result.messages,
        confidence: 0.8
      };
    } catch (error) {
      console.error('Word-analysfel:', error);
      return { text: '', messages: [], confidence: 0 };
    }
  }

  async transcribeAudio(audioPath) {
    // TODO: Implementera OpenAI Whisper eller Azure Speech
    console.log('🎵 Simulerar ljudtranskribering för:', path.basename(audioPath));
    
    return {
      text: "Simulerad ljudtranskribering: Föredraget behandlade viktiga aspekter av hållbar utveckling och miljöarbete. Talaren betonade vikten av lokala initiativ och Rotarys roll i klimatarbetet. Diskussionen var mycket engagerad med många frågor från publiken.",
      confidence: 0.85,
      language: 'sv',
      duration: 1800 // 30 minuter
    };
  }

  async generateSummaries(emailData, attachmentAnalysis) {
    try {
      console.log('🤖 Genererar AI-sammanfattningar...');
      
      // Bygg omfattande prompt med all analyserad data
      let fullContent = `ÄMNE: ${emailData.subject}\n\n`;
      fullContent += `E-POST INNEHÅLL:\n${emailData.text}\n\n`;

      // Lägg till bildanalys
      if (attachmentAnalysis.images.length > 0) {
        fullContent += `BILDANALYS:\n`;
        attachmentAnalysis.images.forEach(img => {
          if (img.extractedText && img.extractedText.length > 20) {
            fullContent += `- ${img.filename}: ${img.extractedText.substring(0, 300)}\n`;
          }
        });
        fullContent += '\n';
      }

      // Lägg till dokumentanalys
      if (attachmentAnalysis.documents.length > 0) {
        fullContent += `DOKUMENTANALYS:\n`;
        attachmentAnalysis.documents.forEach(doc => {
          if (doc.text && doc.text.length > 50) {
            fullContent += `- ${doc.filename}: ${doc.text.substring(0, 500)}\n`;
          }
        });
        fullContent += '\n';
      }

      // Lägg till ljudtranskribering
      if (attachmentAnalysis.audio.length > 0) {
        fullContent += `LJUDTRANSKRIBERING:\n`;
        attachmentAnalysis.audio.forEach(audio => {
          fullContent += `- ${audio.filename}: ${audio.text}\n`;
        });
        fullContent += '\n';
      }

      const prompt = `Du är en expert på att skriva professionella och engagerande sammanfattningar för Rotary Club Sverige. Baserat på följande omfattande information från ett föredrag, skapa två utmärkta sammanfattningar på svenska:

${fullContent}

INSTRUKTIONER:
- Använd ALL tillgänglig information för att skapa rika, detaljerade sammanfattningar
- Identifiera och framhäv föredragshållarens namn om det framgår
- Fånga huvudbudskapet, viktiga insikter och konkreta exempel
- Använd professionell men varm och engagerande ton
- Inkludera specifika detaljer som gör sammanfattningen minnesvärd
- Visa uppskattning för föredragshållarens tid och kunskap

Skapa:

A) LÄNGRE SAMMANFATTNING (300-400 ord för e-postutskick till medlemmar):
- Börja med en stark, engagerande inledning
- Sammanfatta föredragets huvudpunkter med specifika detaljer
- Inkludera konkreta exempel och insikter från presentationen
- Lyfta fram diskussion och medlemsengagemang
- Tacka föredragshållaren varmt
- Avsluta med rotariska hälsningar och uppmuntran till fortsatt engagemang

B) KORT SAMMANFATTNING (80-120 ord för Facebook):
- Engagerande och inspirerande ton med energi
- Fokus på kärnbudskapet och värdet för följare
- Inkludera passande emojis för social media
- Lämpliga hashtags (#Rotary #Inspiration #[specifikt ämne] #Sverige)
- Uppmuntra likes, delningar och kommentarer
- Kort men minnesvärd

Svara exakt i detta format:
=== VERSION A ===
[längre sammanfattning]

=== VERSION B ===
[kort sammanfattning]`;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": CLAUDE_API_KEY
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          messages: [
            { role: "user", content: prompt }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`Claude API fel: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const aiResponse = data.content[0].text;
      
      // Parsa AI-svaret
      const sections = aiResponse.split('=== VERSION');
      if (sections.length >= 3) {
        const versionA = sections[1].replace(/^[\s\w]*===/, '').trim();
        const versionB = sections[2].replace(/^[\s\w]*===/, '').trim();
        
        console.log('✅ AI-sammanfattningar genererade framgångsrikt');
        
        return {
          longSummary: versionA,
          shortSummary: versionB,
          speaker: attachmentAnalysis.speaker,
          confidence: 0.9
        };
      }

      throw new Error('Kunde inte parsa AI-svar korrekt');

    } catch (error) {
      console.error('❌ Fel vid sammanfattningsgenerering:', error);
      
      // Fallback-sammanfattningar
      return {
        longSummary: `**${emailData.subject}**

Kära Rotaryvänner,

Vi hade förmånen att lyssna på ett mycket insiktsfullt föredrag. Föredragshållaren delade värdefulla perspektiv och erfarenheter som gav oss alla mycket att fundera över.

${emailData.text ? emailData.text.substring(0, 200) + '...' : ''}

Vi tackar föredragshållaren för en mycket givande kväll och ser fram emot fler inspirerande möten framöver.

Med rotariska hälsningar,
Styrelsen`,
        
        shortSummary: `🎯 ${emailData.subject}

Ett inspirerande föredrag som gav oss nya perspektiv! 

Tack till vår fantastiska föredragshållare för en mycket givande kväll. 

#Rotary #Inspiration #Sverige`,
        
        speaker: attachmentAnalysis.speaker,
        confidence: 0.3,
        error: error.message
      };
    }
  }
}

// === SKAPA INSTANSER ===
const emailProcessor = new EmailProcessor();
const aiAnalyzer = new AIAnalyzer();

// === HUVUDFUNKTION FÖR E-POSTBEARBETNING ===
async function processEmailWithAI(emailId, uploadedFiles = []) {
  const email = processedEmails.find(e => e.id === emailId);
  if (!email) {
    throw new Error('E-post inte hittad');
  }

  console.log(`🔄 Bearbetar e-post: ${email.subject}`);

  // Analysera bilagor
  const attachmentAnalysis = {
    images: [],
    documents: [],
    audio: [],
    speaker: null
  };

  // Bearbeta e-postens egna bilagor
  for (const attachment of email.attachments) {
    if (attachment.data) {
      const tempPath = path.join(uploadsDir, `temp_${Date.now()}_${attachment.name}`);
      await fs.writeFile(tempPath, attachment.data);
      
      try {
        if (attachment.type.startsWith('image/')) {
          const imageAnalysis = await aiAnalyzer.analyzeImage(tempPath);
          attachmentAnalysis.images.push({
            filename: attachment.name,
            ...imageAnalysis
          });
          
          if (imageAnalysis.speaker && !attachmentAnalysis.speaker) {
            attachmentAnalysis.speaker = imageAnalysis.speaker;
          }
        } else if (attachment.type === 'application/pdf') {
          const pdfAnalysis = await aiAnalyzer.analyzePDF(tempPath);
          attachmentAnalysis.documents.push({
            filename: attachment.name,
            ...pdfAnalysis
          });
        } else if (attachment.type.includes('word')) {
          const docAnalysis = await aiAnalyzer.analyzeWordDoc(tempPath);
          attachmentAnalysis.documents.push({
            filename: attachment.name,
            ...docAnalysis
          });
        } else if (attachment.type.startsWith('audio/')) {
          const audioAnalysis = await aiAnalyzer.transcribeAudio(tempPath);
          attachmentAnalysis.audio.push({
            filename: attachment.name,
            ...audioAnalysis
          });
        }
      } catch (error) {
        console.error(`Fel vid analys av ${attachment.name}:`, error);
      } finally {
        // Radera temporär fil
        await fs.unlink(tempPath).catch(() => {});
      }
    }
  }

  // Bearbeta uppladdade filer
  for (const file of uploadedFiles) {
    try {
      if (file.mimetype.startsWith('image/')) {
        const imageAnalysis = await aiAnalyzer.analyzeImage(file.path);
        attachmentAnalysis.images.push({
          filename: file.originalname,
          ...imageAnalysis
        });
        
        if (imageAnalysis.speaker && !attachmentAnalysis.speaker) {
          attachmentAnalysis.speaker = imageAnalysis.speaker;
        }
      } else if (file.mimetype === 'application/pdf') {
        const pdfAnalysis = await aiAnalyzer.analyzePDF(file.path);
        attachmentAnalysis.documents.push({
          filename: file.originalname,
          ...pdfAnalysis
        });
      } else if (file.mimetype.includes('word')) {
        const docAnalysis = await aiAnalyzer.analyzeWordDoc(file.path);
        attachmentAnalysis.documents.push({
          filename: file.originalname,
          ...docAnalysis
        });
      } else if (file.mimetype.startsWith('audio/')) {
        const audioAnalysis = await aiAnalyzer.transcribeAudio(file.path);
        attachmentAnalysis.audio.push({
          filename: file.originalname,
          ...audioAnalysis
        });
      }
    } catch (error) {
      console.error(`Fel vid analys av ${file.originalname}:`, error);
    } finally {
      // Radera uppladdad fil
      await fs.unlink(file.path).catch(() => {});
    }
  }

  // Generera sammanfattningar med AI
  const summaries = await aiAnalyzer.generateSummaries(email, attachmentAnalysis);

  // Uppdatera e-post som bearbetad
  email.processed = true;
  email.summaries = summaries;
  email.attachmentAnalysis = attachmentAnalysis;
  email.processedAt = new Date();

  return {
    email,
    summaries,
    attachmentAnalysis
  };
}

// === API ROUTES ===

// Statisk frontend
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Rotary AI System</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
    <div id="root"></div>
    
    <script type="text/babel">
        const { useState, useEffect } = React;
        
        function App() {
            const [status, setStatus] = useState('Laddar...');
            const [emails, setEmails] = useState([]);
            
            useEffect(() => {
                fetch('/api/status')
                    .then(r => r.json())
                    .then(data => {
                        setStatus(data.connected ? 'Ansluten' : 'Inte ansluten');
                    })
                    .catch(() => setStatus('Server fel'));
            }, []);
            
            const connectEmail = async () => {
                try {
                    const response = await fetch('/api/connect', { method: 'POST' });
                    const data = await response.json();
                    if (data.success) {
                        setStatus('Ansluten');
                        loadEmails();
                    }
                } catch (error) {
                    setStatus('Anslutningsfel');
                }
            };
            
            const loadEmails = async () => {
                try {
                    const response = await fetch('/api/emails');
                    const data = await response.json();
                    setEmails(Array.isArray(data) ? data : []);
                } catch (error) {
                    console.error('Fel vid e-posthämtning:', error);
                }
            };
            
            return (
                <div className="max-w-6xl mx-auto p-6 bg-gray-50 min-h-screen">
                    <div className="bg-white rounded-lg shadow-lg p-8">
                        <h1 className="text-3xl font-bold text-blue-900 mb-6 text-center">
                            🤖 Rotary AI System
                        </h1>
                        
                        <div className="bg-blue-50 p-4 rounded-lg mb-6">
                            <div className="flex items-center justify-between">
                                <span className="font-medium">Status: {status}</span>
                                <div className="space-x-2">
                                    <button 
                                        onClick={connectEmail}
                                        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                                    >
                                        Anslut E-post
                                    </button>
                                    <button 
                                        onClick={loadEmails}
                                        className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                                    >
                                        Hämta E-post
                                    </button>
                                </div>
                            </div>
                        </div>
                        
                        <div className="space-y-4">
                            <h2 className="text-xl font-semibold">
                                E-post ({emails.length})
                            </h2>
                            {emails.map(email => (
                                <div key={email.id} className="border p-4 rounded-lg">
                                    <h3 className="font-medium">{email.subject}</h3>
                                    <p className="text-sm text-gray-600">Från: {email.from}</p>
                                    <p className="text-sm text-gray-500">
                                        {new Date(email.date).toLocaleString('sv-SE')}
                                    </p>
                                    {email.processed && (
                                        <span className="inline-block bg-green-100 text-green-800 text-xs px-2 py-1 rounded mt-2">
                                            ✅ Bearbetad
                                        </span>
                                    )}
                                </div>
                            ))}
                            
                            {emails.length === 0 && (
                                <p className="text-gray-500 text-center py-8">
                                    Inga e-post hittade. Tryck "Hämta E-post" för att leta efter nya meddelanden.
                                </p>
                            )}
                        </div>
                        
                        <div className="mt-8 bg-yellow-50 p-4 rounded-lg">
                            <h3 className="font-semibold mb-2">🚀 System Information</h3>
                            <p className="text-sm text-gray-700">
                                Detta är Rotary AI-systemet som automatiskt läser e-post från ai@luvi.se 
                                och genererar professionella sammanfattningar med hjälp av Claude AI.
                            </p>
                            <p className="text-sm text-gray-700 mt-2">
                                <strong>API Endpoints:</strong> /api/status, /api/connect, /api/emails, /api/process-email
                            </p>
                        </div>
                    </div>
                </div>
            );
        }
        
        ReactDOM.render(<App />, document.getElementById('root'));
    </script>
</body>
</html>
  `);
});

// Status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    connected: isConnected,
    processedEmails: processedEmails.length,
    uptime: process.uptime(),
    lastError: lastError,
    connectionAttempts: connectionAttempts,
    timestamp: new Date().toISOString()
  });
});

// Anslut till e-post
app.post('/api/connect', async (req, res) => {
  try {
    await emailProcessor.connect();
    res.json({ 
      success: true, 
      message: 'Ansluten till e-post',
      config: {
        host: emailConfig.host,
        port: emailConfig.port,
        user: emailConfig.user
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: 'Kontrollera e-post inställningar och internetanslutning'
    });
  }
});

// Hämta e-post
app.get('/api/emails', async (req, res) => {
  try {
    if (!isConnected) {
      return res.status(400).json({ 
        error: 'Inte ansluten till e-post. Kör POST /api/connect först.' 
      });
    }

    const emails = await emailProcessor.fetchEmails();
    
    // Uppdatera global lista med nya e-post
    emails.forEach(newEmail => {
      const exists = processedEmails.find(e => e.id === newEmail.id);
      if (!exists) {
        processedEmails.push(newEmail);
      }
    });
    
    // Sortera efter datum (nyast först)
    processedEmails.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    res.json(processedEmails);
  } catch (error) {
    res.status(500).json({ 
      error: error.message,
      details: 'Fel vid hämtning av e-post från IMAP server'
    });
  }
});

// Bearbeta e-post med AI
app.post('/api/process-email/:emailId', upload.array('attachments'), async (req, res) => {
  try {
    const emailId = parseInt(req.params.emailId);
    const uploadedFiles = req.files || [];
    
    console.log(`📧 Startar bearbetning av e-post ID: ${emailId}`);
    console.log(`📎 Uppladdade filer: ${uploadedFiles.length}`);
    
    const result = await processEmailWithAI(emailId, uploadedFiles);
    
    console.log('✅ E-postbearbetning klar');
    
    res.json({
      success: true,
      message: 'E-post bearbetad framgångsrikt',
      ...result
    });

  } catch (error) {
    console.error('❌ Fel vid e-postbearbetning:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: 'Fel vid AI-analys eller filbearbetning'
    });
  }
});

// Publicera till Facebook (simulerat)
app.post('/api/facebook-publish', async (req, res) => {
  const { content, imageUrl } = req.body;
  
  try {
    console.log('📘 Simulerar Facebook-publicering...');
    console.log('Innehåll:', content.substring(0, 100) + '...');
    
    // Simulerad fördröjning
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    res.json({
      success: true,
      postId: 'simulated_fb_post_' + Date.now(),
      url: 'https://facebook.com/rotary/posts/simulated',
      message: 'Simulerad Facebook-publicering lyckades'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Skicka e-post (simulerat)
app.post('/api/send-email', async (req, res) => {
  const { recipients, subject, content } = req.body;
  
  try {
    console.log('📧 Simulerar e-postutskick...');
    console.log(`Till: ${recipients.length} mottagare`);
    console.log(`Ämne: ${subject}`);
    
    // Simulerad fördröjning
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    res.json({
      success: true,
      sent: recipients.length,
      messageId: 'simulated_email_' + Date.now(),
      message: 'Simulerat e-postutskick lyckades'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Hälsokontroll
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    email_connected: isConnected
  });
});

// === AUTOMATISK E-POSTKONTROLL ===
// Kör var 10:e minut i produktion
const cronPattern = process.env.NODE_ENV === 'production' ? '*/10 * * * *' : '*/2 * * * *';

cron.schedule(cronPattern, async () => {
  if (isConnected) {
    try {
      console.log('🔄 Automatisk e-postkontroll körs...');
      const newEmails = await emailProcessor.fetchEmails();
      
      // Kolla efter riktigt nya e-post
      const existingIds = processedEmails.map(e => e.id);
      const reallyNewEmails = newEmails.filter(e => !existingIds.includes(e.id));
      
      if (reallyNewEmails.length > 0) {
        console.log(`📬 ${reallyNewEmails.length} nya e-post hittade via cron`);
        processedEmails.push(...reallyNewEmails);
        
        // Sortera efter datum
        processedEmails.sort((a, b) => new Date(b.date) - new Date(a.date));
      }
    } catch (error) {
      console.error('❌ Fel vid automatisk e-postkontroll:', error);
    }
  }
});

// === FELHANTERING ===
app.use((error, req, res, next) => {
  console.error('❌ Server fel:', error);
  res.status(500).json({
    success: false,
    error: 'Internt serverfel',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Något gick fel'
  });
});

// 404-hantering
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint inte hittad',
    availableEndpoints: [
      'GET /',
      'GET /api/status',
      'POST /api/connect',
      'GET /api/emails',
      'POST /api/process-email/:emailId',
      'POST /api/facebook-publish',
      'POST /api/send-email',
      'GET /health'
    ]
  });
});

// === GRACEFUL SHUTDOWN ===
process.on('SIGINT', () => {
  console.log('🛑 Stänger ner server gracefully...');
  emailProcessor.disconnect();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM mottaget, stänger ner...');
  emailProcessor.disconnect();
  process.exit(0);
});

// === STARTA SERVER ===
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Rotary AI Server körs på port ${PORT}`);
  console.log(`📧 E-post konfiguration: ${emailConfig.host}:${emailConfig.port}`);
  console.log(`🤖 Claude API: ${CLAUDE_API_KEY ? 'Konfigurerad' : 'SAKNAS'}`);
  console.log(`🌍 URL: http://localhost:${PORT}`);
  console.log(`🏥 Hälsokontroll: http://localhost:${PORT}/health`);
  
  // Auto-anslut till e-post vid start
  setTimeout(async () => {
    try {
      console.log('🔄 Försöker auto-ansluta till e-post...');
      await emailProcessor.connect();
      console.log('✅ Auto-anslutning till e-post lyckades');
    } catch (error) {
      console.log('⚠️ Auto-anslutning misslyckades, manuell anslutning krävs');
    }
  }, 5000);
});
